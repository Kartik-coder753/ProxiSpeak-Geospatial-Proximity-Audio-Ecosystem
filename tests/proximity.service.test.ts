import { describe, it, expect, beforeEach } from 'vitest';
import { ProximityService } from '../src/modules/proximity/proximity.service';
import { MongoGeospatialStore } from '../src/modules/proximity/mongodb/mongo-geospatial.store';
import { IPresenceReader, PeerEligibilityChangeEvent } from '../src/shared/contracts/proximity.interface';
import { AvatarPosition } from '../src/shared/contracts/presence.types';

describe('ProximityService & MongoDB Geospatial Unit Tests', () => {
  let mongoStore: MongoGeospatialStore;
  let proximityService: ProximityService;
  let mockPresenceMembers: Map<string, { position: AvatarPosition; isOnline: boolean; lastSeenAt: number; officeId: string }>;

  const mockPresenceReader: IPresenceReader = {
    getUserPosition(userId: string, officeId?: string): AvatarPosition | null {
      const m = mockPresenceMembers.get(userId);
      if (!m || (officeId && m.officeId !== officeId)) return null;
      return m.position;
    },
    getUserOffice(userId: string): string | null {
      return mockPresenceMembers.get(userId)?.officeId ?? null;
    },
    getOfficeSnapshot(officeId: string) {
      const members = Array.from(mockPresenceMembers.entries())
        .filter(([, m]) => m.officeId === officeId)
        .map(([userId, m]) => ({
          userId,
          position: m.position,
          isOnline: m.isOnline,
          lastSeenAt: m.lastSeenAt,
        }));
      return { members };
    },
    getOnlineUsers(): string[] {
      return Array.from(mockPresenceMembers.entries())
        .filter(([, m]) => m.isOnline)
        .map(([u]) => u);
    },
  };

  beforeEach(() => {
    mongoStore = new MongoGeospatialStore();
    proximityService = new ProximityService(mockPresenceReader, mongoStore, {
      entryRadius: 100,
      exitRadius: 110,
      staleTimeoutMs: 15000,
    });

    mockPresenceMembers = new Map();
  });

  const setUser = (
    userId: string,
    officeId: string,
    x: number,
    y: number,
    isOnline = true,
    lastSeenAt = Date.now()
  ) => {
    const position: AvatarPosition = { x, y, sequence: 1, timestamp: lastSeenAt, facing: 'down' };
    mockPresenceMembers.set(userId, { position, isOnline, lastSeenAt, officeId });
    mongoStore.upsertAvatar(userId, officeId, [x, y], new Date(lastSeenAt));
  };

  it('verifies MongoDB flat 2d index and $near / $geoWithin queries', () => {
    setUser('alice', 'infotact-office', 200, 250);
    setUser('bob', 'infotact-office', 260, 280); // distance ~ 67.08
    setUser('charlie', 'infotact-office', 200, 340); // distance = 90
    setUser('dave', 'infotact-office', 400, 400); // distance ~ 250 (out of 100px range)

    // Verify 2d index is registered
    expect(mongoStore.getIndexes()).toContain('position_2d');
    expect(mongoStore.getIndexes()).toContain('officeId_1_position_2d');

    // 1. $near query ordered by distance ascending
    const nearResults = proximityService.queryNearbyViaNear('infotact-office', [200, 250], 100, 'alice');
    expect(nearResults).toHaveLength(2);
    expect(nearResults[0].userId).toBe('bob'); // ~67.08px
    expect(nearResults[1].userId).toBe('charlie'); // 90px

    // 2. $geoWithin circular query
    const geoWithinResults = proximityService.queryNearbyViaGeoWithin('infotact-office', [200, 250], 100, 'alice');
    expect(geoWithinResults).toHaveLength(2);
    const userIds = geoWithinResults.map((d) => d.userId);
    expect(userIds).toContain('bob');
    expect(userIds).toContain('charlie');
    expect(userIds).not.toContain('dave');
  });

  it('detects peer eligibility at zero distance and identical coordinates', async () => {
    setUser('alice', 'infotact-office', 200, 200);
    setUser('bob', 'infotact-office', 200, 200);

    const result = await proximityService.calculateProximity('alice', 'infotact-office');
    expect(result).not.toBeNull();
    expect(result?.peers).toHaveLength(1);
    expect(result?.peers[0].userId).toBe('bob');
    expect(result?.peers[0].distance).toBe(0);
  });

  it('handles exact boundary distances (just inside, exactly at, and just outside entry radius)', async () => {
    setUser('alice', 'infotact-office', 100, 100);

    // Candidate 1: Just inside radius (99.9 px) -> (100, 199.9)
    setUser('peer-inside', 'infotact-office', 100, 199.9);

    // Candidate 2: Exactly at radius (100.0 px) -> (100, 200.0)
    setUser('peer-exact', 'infotact-office', 100, 200.0);

    // Candidate 3: Just outside radius (100.1 px) -> (100, 200.1)
    setUser('peer-outside', 'infotact-office', 100, 200.1);

    const result = await proximityService.calculateProximity('alice', 'infotact-office');
    expect(result).not.toBeNull();

    const peerIds = result?.peers.map((p) => p.userId) ?? [];
    expect(peerIds).toContain('peer-inside');
    expect(peerIds).toContain('peer-exact');
    expect(peerIds).not.toContain('peer-outside');
  });

  it('strictly enforces office isolation (different offices never share earshot)', async () => {
    // Alice is in infotact-office at (300, 300)
    setUser('alice', 'infotact-office', 300, 300);

    // Bob is at the EXACT same coordinates (300, 300) but in executive-boardroom
    setUser('bob', 'executive-boardroom', 300, 300);

    const aliceResult = await proximityService.calculateProximity('alice', 'infotact-office');
    expect(aliceResult?.peers).toHaveLength(0);

    const bobResult = await proximityService.calculateProximity('bob', 'executive-boardroom');
    expect(bobResult?.peers).toHaveLength(0);
  });

  it('prevents boundary churn using exit hysteresis (100px entry, 110px exit)', async () => {
    const emittedEvents: PeerEligibilityChangeEvent[] = [];
    proximityService.subscribeToPeerChanges((e) => emittedEvents.push(e));

    setUser('alice', 'infotact-office', 100, 100);

    // Step 1: Bob enters earshot at distance 95px (100, 195)
    setUser('bob', 'infotact-office', 100, 195);
    await proximityService.calculateProximity('alice', 'infotact-office');

    expect(proximityService.getPeersForUser('alice').map((p) => p.userId)).toContain('bob');
    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0].enteredPeers.map((p) => p.userId)).toContain('bob');

    // Step 2: Bob moves to distance 105px (100, 205).
    // This is > 100px entry, but <= 110px exit hysteresis.
    // Bob MUST REMAINS AN ACTIVE PEER! No exit event should be emitted.
    setUser('bob', 'infotact-office', 100, 205);
    await proximityService.calculateProximity('alice', 'infotact-office');

    expect(proximityService.getPeersForUser('alice').map((p) => p.userId)).toContain('bob');
    // Events count should still be 1 (no churn!)
    expect(emittedEvents).toHaveLength(1);

    // Step 3: Bob moves repeatedly between 98px and 106px (boundary jitter)
    setUser('bob', 'infotact-office', 100, 198);
    await proximityService.calculateProximity('alice', 'infotact-office');
    setUser('bob', 'infotact-office', 100, 207);
    await proximityService.calculateProximity('alice', 'infotact-office');
    setUser('bob', 'infotact-office', 100, 202);
    await proximityService.calculateProximity('alice', 'infotact-office');

    // Bob has stayed continuously within the 110px exit zone, so peer connection remained stable throughout
    expect(proximityService.getPeersForUser('alice').map((p) => p.userId)).toContain('bob');
    expect(emittedEvents).toHaveLength(1);

    // Step 4: Bob steps outside the hysteresis boundary to 115px (100, 215)
    setUser('bob', 'infotact-office', 100, 215);
    await proximityService.calculateProximity('alice', 'infotact-office');

    expect(proximityService.getPeersForUser('alice').map((p) => p.userId)).not.toContain('bob');
    expect(emittedEvents).toHaveLength(2);
    expect(emittedEvents[1].exitedPeerIds).toContain('bob');

    // Step 5: Bob moves to 105px. Since he is no longer an active peer,
    // he CANNOT re-enter at 105px; he must reach <= 100px.
    setUser('bob', 'infotact-office', 100, 205);
    await proximityService.calculateProximity('alice', 'infotact-office');
    expect(proximityService.getPeersForUser('alice').map((p) => p.userId)).not.toContain('bob');

    // Step 6: Bob moves to 95px -> Re-enters!
    setUser('bob', 'infotact-office', 100, 195);
    await proximityService.calculateProximity('alice', 'infotact-office');
    expect(proximityService.getPeersForUser('alice').map((p) => p.userId)).toContain('bob');
    expect(emittedEvents).toHaveLength(3);
    expect(emittedEvents[2].enteredPeers.map((p) => p.userId)).toContain('bob');
  });

  it('filters out offline and stale user positions', async () => {
    setUser('alice', 'infotact-office', 200, 200);

    // Bob is within range (50px away) but is OFFLINE
    setUser('bob', 'infotact-office', 200, 250, false);

    // Charlie is within range (40px away) but position timestamp is 30 seconds old (STALE)
    const thirtySecondsAgo = Date.now() - 30000;
    setUser('charlie', 'infotact-office', 200, 240, true, thirtySecondsAgo);

    // Dave is active and fresh (60px away)
    setUser('dave', 'infotact-office', 200, 260, true, Date.now());

    const result = await proximityService.calculateProximity('alice', 'infotact-office');
    expect(result).not.toBeNull();

    const peerIds = result?.peers.map((p) => p.userId) ?? [];
    expect(peerIds).not.toContain('bob'); // Offline
    expect(peerIds).not.toContain('charlie'); // Stale
    expect(peerIds).toContain('dave'); // Online and fresh
  });

  it('handles simultaneous movement across multiple users', async () => {
    const users = ['u1', 'u2', 'u3', 'u4', 'u5'];
    // Position them in a cluster around (400, 400)
    users.forEach((uid, idx) => {
      setUser(uid, 'infotact-office', 400 + idx * 15, 400);
    });

    // Run simultaneous movements concurrently
    await Promise.all(
      users.map((uid, idx) =>
        proximityService.onPositionChanged({
          userId: uid,
          officeId: 'infotact-office',
          position: {
            x: 400 + idx * 18,
            y: 400 + (idx % 2 === 0 ? 10 : -10),
            sequence: 2,
            timestamp: Date.now(),
          },
        })
      )
    );

    // All adjacent users should have peers correctly calculated
    const u1Peers = proximityService.getPeersForUser('u1');
    expect(u1Peers.length).toBeGreaterThan(0);
    expect(u1Peers.some((p) => p.userId === 'u2')).toBe(true);
  });

  it('immediately cleans up peers when user leaves or disconnects', async () => {
    setUser('alice', 'infotact-office', 100, 100);
    setUser('bob', 'infotact-office', 100, 150);

    await proximityService.calculateProximity('alice', 'infotact-office');
    await proximityService.calculateProximity('bob', 'infotact-office');

    expect(proximityService.getPeersForUser('alice').map((p) => p.userId)).toContain('bob');
    expect(proximityService.getPeersForUser('bob').map((p) => p.userId)).toContain('alice');

    // Bob leaves office
    await proximityService.onUserLeft('bob', 'infotact-office');

    // Alice should immediately have Bob removed
    expect(proximityService.getPeersForUser('alice').map((p) => p.userId)).not.toContain('bob');
    expect(proximityService.getPeersForUser('bob')).toHaveLength(0);
  });
});
