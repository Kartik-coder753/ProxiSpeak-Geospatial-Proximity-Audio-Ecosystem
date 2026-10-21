import { describe, it, expect } from 'vitest';
import { ProximityService } from '../src/modules/proximity/proximity.service';
import { MongoGeospatialStore } from '../src/modules/proximity/mongodb/mongo-geospatial.store';
import { IPresenceReader } from '../src/shared/contracts/proximity.interface';
import { AvatarPosition } from '../src/shared/contracts/presence.types';

interface BenchmarkMetrics {
  userCount: number;
  queryLatencyAvgMs: number;
  queryLatencyP95Ms: number;
  queryLatencyMaxMs: number;
  totalServiceLatencyAvgMs: number;
  totalServiceLatencyP95Ms: number;
  totalServiceLatencyMaxMs: number;
}

describe('Proximity Geospatial Performance Benchmarks', () => {
  const officeId = 'infotact-office';
  const officeBounds = { minX: 0, minY: 0, maxX: 1200, maxY: 800 };

  function setupSimulatedEnvironment(userCount: number) {
    const mongoStore = new MongoGeospatialStore();
    const mockPresenceMembers = new Map<string, { position: AvatarPosition; isOnline: boolean; lastSeenAt: number; officeId: string }>();

    // Seed users systematically across the office grid with realistic clustering
    for (let i = 0; i < userCount; i++) {
      const userId = `sim-user-${i}`;
      // Distribute in realistic clusters around desks, meeting tables, lounges
      const clusterBaseX = (i % 5) * 220 + 100;
      const clusterBaseY = Math.floor(i / 5) * 40 + 80;
      const x = Math.min(officeBounds.maxX - 20, Math.max(20, clusterBaseX + ((i * 17) % 60)));
      const y = Math.min(officeBounds.maxY - 20, Math.max(20, clusterBaseY + ((i * 23) % 50)));

      const now = Date.now();
      const pos: AvatarPosition = { x, y, sequence: 1, timestamp: now, facing: 'down' };

      mockPresenceMembers.set(userId, { position: pos, isOnline: true, lastSeenAt: now, officeId });
      mongoStore.upsertAvatar(userId, officeId, [x, y], new Date(now));
    }

    const presenceReader: IPresenceReader = {
      getUserPosition(userId: string) {
        return mockPresenceMembers.get(userId)?.position ?? null;
      },
      getUserOffice(userId: string) {
        return mockPresenceMembers.get(userId)?.officeId ?? null;
      },
      getOfficeSnapshot() {
        const members = Array.from(mockPresenceMembers.entries()).map(([userId, m]) => ({
          userId,
          position: m.position,
          isOnline: m.isOnline,
          lastSeenAt: m.lastSeenAt,
        }));
        return { members };
      },
      getOnlineUsers() {
        return Array.from(mockPresenceMembers.keys());
      },
    };

    const proximityService = new ProximityService(presenceReader, mongoStore, {
      entryRadius: 100,
      exitRadius: 110,
      staleTimeoutMs: 15000,
    });

    return { mongoStore, proximityService, mockPresenceMembers };
  }

  function runBenchmarkForScale(userCount: number, sampleRuns = 100): BenchmarkMetrics {
    const { proximityService } = setupSimulatedEnvironment(userCount);

    const queryLatencies: number[] = [];
    const totalLatencies: number[] = [];

    // Test a mix of active users moving across the office
    for (let r = 0; r < sampleRuns; r++) {
      const targetUserId = `sim-user-${r % userCount}`;
      const center: [number, number] = [
        100 + ((r * 31) % (officeBounds.maxX - 200)),
        100 + ((r * 23) % (officeBounds.maxY - 200)),
      ];

      // 1. Measure pure MongoDB Geospatial Query latency ($near)
      const tQueryStart = performance.now();
      proximityService.queryNearbyViaNear(officeId, center, 110, targetUserId);
      const tQueryEnd = performance.now();
      queryLatencies.push(tQueryEnd - tQueryStart);

      // 2. Measure Total Proximity Calculation latency
      const tTotalStart = performance.now();
      proximityService.calculateProximity(targetUserId, officeId, {
        x: center[0],
        y: center[1],
        sequence: r + 1,
        timestamp: Date.now(),
      });
      const tTotalEnd = performance.now();
      totalLatencies.push(tTotalEnd - tTotalStart);
    }

    queryLatencies.sort((a, b) => a - b);
    totalLatencies.sort((a, b) => a - b);

    const p95Index = Math.floor(sampleRuns * 0.95);

    const queryAvg = queryLatencies.reduce((a, b) => a + b, 0) / sampleRuns;
    const totalAvg = totalLatencies.reduce((a, b) => a + b, 0) / sampleRuns;

    return {
      userCount,
      queryLatencyAvgMs: Math.round(queryAvg * 1000) / 1000,
      queryLatencyP95Ms: Math.round(queryLatencies[p95Index] * 1000) / 1000,
      queryLatencyMaxMs: Math.round(queryLatencies[sampleRuns - 1] * 1000) / 1000,
      totalServiceLatencyAvgMs: Math.round(totalAvg * 1000) / 1000,
      totalServiceLatencyP95Ms: Math.round(totalLatencies[p95Index] * 1000) / 1000,
      totalServiceLatencyMaxMs: Math.round(totalLatencies[sampleRuns - 1] * 1000) / 1000,
    };
  }

  it('runs benchmark for 50 simulated users and verifies < 20ms constraint', () => {
    const metrics = runBenchmarkForScale(50, 100);
    console.log('\n--- PROXISPEAK PROXIMITY BENCHMARK: 50 USERS ---');
    console.log(`Database Query Latency: Avg ${metrics.queryLatencyAvgMs} ms, P95 ${metrics.queryLatencyP95Ms} ms, Max ${metrics.queryLatencyMaxMs} ms`);
    console.log(`Total Proximity Latency: Avg ${metrics.totalServiceLatencyAvgMs} ms, P95 ${metrics.totalServiceLatencyP95Ms} ms, Max ${metrics.totalServiceLatencyMaxMs} ms`);

    expect(metrics.queryLatencyAvgMs).toBeLessThan(20);
    expect(metrics.totalServiceLatencyAvgMs).toBeLessThan(20);
    expect(metrics.totalServiceLatencyP95Ms).toBeLessThan(20);
  });

  it('runs benchmark for 100 simulated users and verifies < 20ms constraint', () => {
    const metrics = runBenchmarkForScale(100, 100);
    console.log('\n--- PROXISPEAK PROXIMITY BENCHMARK: 100 USERS ---');
    console.log(`Database Query Latency: Avg ${metrics.queryLatencyAvgMs} ms, P95 ${metrics.queryLatencyP95Ms} ms, Max ${metrics.queryLatencyMaxMs} ms`);
    console.log(`Total Proximity Latency: Avg ${metrics.totalServiceLatencyAvgMs} ms, P95 ${metrics.totalServiceLatencyP95Ms} ms, Max ${metrics.totalServiceLatencyMaxMs} ms`);

    expect(metrics.queryLatencyAvgMs).toBeLessThan(20);
    expect(metrics.totalServiceLatencyAvgMs).toBeLessThan(20);
    expect(metrics.totalServiceLatencyP95Ms).toBeLessThan(20);
  });

  it('runs benchmark for 250 simulated users and verifies < 20ms constraint', () => {
    const metrics = runBenchmarkForScale(250, 100);
    console.log('\n--- PROXISPEAK PROXIMITY BENCHMARK: 250 USERS ---');
    console.log(`Database Query Latency: Avg ${metrics.queryLatencyAvgMs} ms, P95 ${metrics.queryLatencyP95Ms} ms, Max ${metrics.queryLatencyMaxMs} ms`);
    console.log(`Total Proximity Latency: Avg ${metrics.totalServiceLatencyAvgMs} ms, P95 ${metrics.totalServiceLatencyP95Ms} ms, Max ${metrics.totalServiceLatencyMaxMs} ms`);

    expect(metrics.queryLatencyAvgMs).toBeLessThan(20);
    expect(metrics.totalServiceLatencyAvgMs).toBeLessThan(20);
    expect(metrics.totalServiceLatencyP95Ms).toBeLessThan(20);
  });
});
