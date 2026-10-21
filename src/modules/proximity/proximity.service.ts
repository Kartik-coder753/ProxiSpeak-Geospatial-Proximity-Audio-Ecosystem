import {
  IProximityService,
  IPresenceReader,
  PositionChangedEvent,
  UserPresenceChangedEvent,
  ProximityResult,
  ProximityPeer,
  PeerEligibilityChangeEvent,
  MongoAvatarDocument,
} from '../../shared/contracts/proximity.interface';
import { AvatarPosition } from '../../shared/contracts/presence.types';
import { MongoGeospatialStore } from './mongodb/mongo-geospatial.store';

export interface ProximityConfig {
  entryRadius: number;       // Nominal radius to enter earshot (default: 100 pixels)
  exitRadius: number;        // Hysteresis boundary to leave earshot (default: 110 pixels)
  staleTimeoutMs: number;    // Maximum age of position before marked stale (default: 15,000 ms)
  queryStrategy: '$near' | '$geoWithin';
}

export const DEFAULT_PROXIMITY_CONFIG: ProximityConfig = {
  entryRadius: 100,
  exitRadius: 110,
  staleTimeoutMs: 15000,
  queryStrategy: '$near',
};

/**
 * Proximity Service (Member 2 - Geospatial Engine)
 * Determines which avatars are in earshot using MongoDB flat-coordinate geospatial queries,
 * Euclidean distance calculation, office isolation, stale-user filtering, and exit hysteresis.
 */
export class ProximityService implements IProximityService {
  private readonly config: ProximityConfig;
  private readonly mongoStore: MongoGeospatialStore;
  private presenceReader?: IPresenceReader;

  // Active Peer Sets for Hysteresis: userId -> Map<peerUserId, distance>
  private activePeerSets = new Map<string, Map<string, number>>();

  // Event subscribers (Signaling module / Person 3)
  private subscribers = new Set<(event: PeerEligibilityChangeEvent) => void>();

  // Diagnostic history for testing & verification
  private lastPositionEvents: PositionChangedEvent[] = [];
  private presenceEvents: UserPresenceChangedEvent[] = [];

  constructor(
    presenceReader?: IPresenceReader,
    mongoStore?: MongoGeospatialStore,
    options?: Partial<ProximityConfig>
  ) {
    this.presenceReader = presenceReader;
    this.mongoStore = mongoStore ?? new MongoGeospatialStore();
    this.config = { ...DEFAULT_PROXIMITY_CONFIG, ...options };
  }

  setPresenceReader(reader: IPresenceReader): void {
    this.presenceReader = reader;
  }

  getMongoStore(): MongoGeospatialStore {
    return this.mongoStore;
  }

  getConfig(): Readonly<ProximityConfig> {
    return this.config;
  }

  /**
   * Called by Presence module when an avatar moves
   */
  async onPositionChanged(event: PositionChangedEvent): Promise<ProximityResult | null> {
    // Record diagnostic event for test compatibility
    this.lastPositionEvents.push(event);
    if (this.lastPositionEvents.length > 100) {
      this.lastPositionEvents.shift();
    }

    const { userId, officeId, position } = event;

    // Update MongoDB 2d geospatial store
    this.mongoStore.upsertAvatar(userId, officeId, [position.x, position.y], new Date(position.timestamp || Date.now()));

    // Calculate proximity and emit peer changes
    return await this.calculateProximity(userId, officeId, position);
  }

  /**
   * Called by Presence module when user presence changes (joined or left)
   */
  async onUserPresenceChanged(event: UserPresenceChangedEvent): Promise<void> {
    this.presenceEvents.push(event);
    if (this.presenceEvents.length > 100) {
      this.presenceEvents.shift();
    }

    if (event.type === 'joined' && event.position) {
      this.mongoStore.upsertAvatar(
        event.userId,
        event.officeId,
        [event.position.x, event.position.y],
        new Date(event.position.timestamp || Date.now())
      );
      await this.calculateProximity(event.userId, event.officeId, event.position);
    } else if (event.type === 'left') {
      await this.onUserLeft(event.userId, event.officeId);
    }
  }

  /**
   * Immediate cleanup and peer re-evaluation on user departure or disconnect
   */
  async onUserLeft(userId: string, officeId: string): Promise<void> {
    this.presenceEvents.push({
      userId,
      officeId,
      type: 'left',
    });

    // Remove from MongoDB store
    this.mongoStore.deleteAvatar(userId);

    // Get peers that this user had
    const userPreviousPeers = this.activePeerSets.get(userId);
    this.activePeerSets.delete(userId);

    const now = Date.now();

    // If this user had peers, inform those peers that this user is gone immediately
    for (const [otherUserId, otherPeers] of this.activePeerSets.entries()) {
      if (otherPeers.has(userId)) {
        otherPeers.delete(userId);

        const currentPeerList: ProximityPeer[] = Array.from(otherPeers.entries()).map(
          ([pId, dist]) => ({ userId: pId, distance: dist })
        );

        this.emitPeerEligibilityChange({
          userId: otherUserId,
          officeId,
          enteredPeers: [],
          exitedPeerIds: [userId],
          currentPeers: currentPeerList,
          calculatedAt: now,
        });
      }
    }

    // If the departing user had peers, emit exit for them as well
    if (userPreviousPeers && userPreviousPeers.size > 0) {
      this.emitPeerEligibilityChange({
        userId,
        officeId,
        enteredPeers: [],
        exitedPeerIds: Array.from(userPreviousPeers.keys()),
        currentPeers: [],
        calculatedAt: now,
      });
    }
  }

  /**
   * Execute proximity calculation for a given user in an office
   */
  async calculateProximity(
    userId: string,
    officeId?: string,
    currentPositionOverride?: AvatarPosition
  ): Promise<ProximityResult | null> {
    const targetOfficeId = officeId ?? this.presenceReader?.getUserOffice(userId);
    if (!targetOfficeId) return null;

    const userPos = currentPositionOverride ?? this.presenceReader?.getUserPosition(userId, targetOfficeId);
    if (!userPos) return null;

    const point: [number, number] = [userPos.x, userPos.y];
    const now = Date.now();

    // 1. Query candidate peers using MongoDB flat geospatial index
    // Search up to exitRadius so existing peers within the hysteresis boundary are retrieved
    let candidateDocs: MongoAvatarDocument[];
    if (this.config.queryStrategy === '$geoWithin') {
      candidateDocs = this.queryNearbyViaGeoWithin(targetOfficeId, point, this.config.exitRadius, userId);
    } else {
      candidateDocs = this.queryNearbyViaNear(targetOfficeId, point, this.config.exitRadius, userId);
    }

    // 2. Fetch current active members from presence reader to validate online and stale status
    const officeSnapshot = this.presenceReader?.getOfficeSnapshot(targetOfficeId);
    const memberMap = new Map<string, { isOnline: boolean; lastSeenAt: number }>();
    if (officeSnapshot) {
      for (const m of officeSnapshot.members) {
        memberMap.set(m.userId, { isOnline: m.isOnline, lastSeenAt: m.lastSeenAt });
      }
    }

    // 3. Current active peer set for this user (for hysteresis comparison)
    const previousPeers = this.activePeerSets.get(userId) ?? new Map<string, number>();
    const newPeers = new Map<string, number>();

    const enteredPeers: ProximityPeer[] = [];

    for (const doc of candidateDocs) {
      // Office isolation check: cross-office candidates strictly rejected
      if (doc.officeId !== targetOfficeId) continue;
      if (doc.userId === userId) continue;

      // Stale-user and offline check
      if (memberMap.size > 0) {
        const memberInfo = memberMap.get(doc.userId);
        if (!memberInfo || !memberInfo.isOnline) {
          continue; // User is offline
        }
        if (now - memberInfo.lastSeenAt > this.config.staleTimeoutMs) {
          continue; // User position is stale
        }
      } else {
        // Fallback to document updatedAt
        if (now - doc.updatedAt.getTime() > this.config.staleTimeoutMs) {
          continue;
        }
      }

      // Calculate exact Euclidean distance: d = sqrt((x2 - x1)^2 + (y2 - y1)^2)
      const exactDistance = Math.hypot(doc.position[0] - point[0], doc.position[1] - point[1]);
      const roundedDistance = Math.round(exactDistance * 100) / 100;

      const wasAlreadyPeer = previousPeers.has(doc.userId);

      // Exit Hysteresis:
      // If candidate was already a peer, keep them until they exceed exitRadius (e.g. 110px).
      // If candidate is new, they must be within entryRadius (e.g. 100px) to enter earshot.
      if (wasAlreadyPeer) {
        if (roundedDistance <= this.config.exitRadius) {
          newPeers.set(doc.userId, roundedDistance);
        }
      } else {
        if (roundedDistance <= this.config.entryRadius) {
          newPeers.set(doc.userId, roundedDistance);
          enteredPeers.push({ userId: doc.userId, distance: roundedDistance });
        }
      }
    }

    // Detect exited peers
    const exitedPeerIds: string[] = [];
    for (const [prevUserId] of previousPeers.entries()) {
      if (!newPeers.has(prevUserId)) {
        exitedPeerIds.push(prevUserId);
      }
    }

    // Update active peer map for this user
    this.activePeerSets.set(userId, newPeers);

    const currentPeersList: ProximityPeer[] = Array.from(newPeers.entries()).map(([pId, dist]) => ({
      userId: pId,
      distance: dist,
    }));

    // Emit event if there are meaningful entry or exit changes
    if (enteredPeers.length > 0 || exitedPeerIds.length > 0) {
      this.emitPeerEligibilityChange({
        userId,
        officeId: targetOfficeId,
        enteredPeers,
        exitedPeerIds,
        currentPeers: currentPeersList,
        calculatedAt: now,
      });
    }

    return {
      userId,
      officeId: targetOfficeId,
      peers: currentPeersList,
      calculatedAt: now,
    };
  }

  /**
   * MongoDB $near query implementation
   */
  queryNearbyViaNear(
    officeId: string,
    point: [number, number],
    maxDistance: number,
    excludeUserId?: string
  ): MongoAvatarDocument[] {
    return this.mongoStore.find({
      officeId,
      userId: excludeUserId ? { $ne: excludeUserId } : undefined,
      position: {
        $near: point,
        $maxDistance: maxDistance,
      },
    });
  }

  /**
   * MongoDB $geoWithin query implementation using circular $center
   */
  queryNearbyViaGeoWithin(
    officeId: string,
    center: [number, number],
    radius: number,
    excludeUserId?: string
  ): MongoAvatarDocument[] {
    return this.mongoStore.find({
      officeId,
      userId: excludeUserId ? { $ne: excludeUserId } : undefined,
      position: {
        $geoWithin: {
          $center: [center, radius],
        },
      },
    });
  }

  getPeersForUser(userId: string): ProximityPeer[] {
    const map = this.activePeerSets.get(userId);
    if (!map) return [];
    return Array.from(map.entries()).map(([peerId, distance]) => ({
      userId: peerId,
      distance,
    }));
  }

  subscribeToPeerChanges(listener: (event: PeerEligibilityChangeEvent) => void): () => void {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  private emitPeerEligibilityChange(event: PeerEligibilityChangeEvent): void {
    for (const listener of this.subscribers) {
      try {
        listener(event);
      } catch (err) {
        console.error('Error in peer eligibility subscriber:', err);
      }
    }
  }

  // Diagnostic helpers for testing
  getLastPositionEvent(): PositionChangedEvent | undefined {
    return this.lastPositionEvents[this.lastPositionEvents.length - 1];
  }

  getPresenceEvents(): UserPresenceChangedEvent[] {
    return [...this.presenceEvents];
  }

  clear(): void {
    this.activePeerSets.clear();
    this.mongoStore.clear();
    this.lastPositionEvents = [];
    this.presenceEvents = [];
  }
}
