import { AvatarPosition } from './presence.types';

export interface PositionChangedEvent {
  userId: string;
  officeId: string;
  position: AvatarPosition;
  previousPosition?: AvatarPosition;
}

export interface UserPresenceChangedEvent {
  userId: string;
  officeId: string;
  type: 'joined' | 'left';
  position?: AvatarPosition;
}

/**
 * MongoDB Document representation of avatar position with flat 2d coordinates
 */
export interface MongoAvatarDocument {
  _id?: string;
  userId: string;
  officeId: string;
  position: [number, number]; // [x, y] flat 2d coordinates
  updatedAt: Date;
}

/**
 * A qualifying peer within earshot distance
 */
export interface ProximityPeer {
  userId: string;
  distance: number; // Euclidean distance in pixels
}

/**
 * Complete proximity evaluation result for an avatar
 */
export interface ProximityResult {
  userId: string;
  officeId: string;
  peers: ProximityPeer[];
  calculatedAt: number;
}

/**
 * Peer eligibility event emitted for Person 3 (WebRTC Signaling)
 * Containing strictly the entered and exited peer diffs along with the current peer state
 */
export interface PeerEligibilityChangeEvent {
  userId: string;
  officeId: string;
  enteredPeers: ProximityPeer[];
  exitedPeerIds: string[];
  currentPeers: ProximityPeer[];
  calculatedAt: number;
}

/**
 * Contract to read live positions from the authoritative presence module
 * without duplicating active user state
 */
export interface IPresenceReader {
  getUserPosition(userId: string, officeId?: string): AvatarPosition | null;
  getUserOffice(userId: string): string | null;
  getOfficeSnapshot(officeId: string): {
    members: Array<{
      userId: string;
      position: AvatarPosition;
      isOnline: boolean;
      lastSeenAt: number;
    }>;
  };
  getOnlineUsers(): string[];
}

/**
 * Proximity Service Interface (Person 2's module)
 * Injected into the presence module so the movement and presence handlers
 * can trigger spatial proximity recalculations without coupling to its internal implementation.
 */
export interface IProximityService {
  onPositionChanged(event: PositionChangedEvent): Promise<ProximityResult | null | void>;
  onUserPresenceChanged(event: UserPresenceChangedEvent): Promise<void>;
  onUserLeft(userId: string, officeId: string): Promise<void>;
  calculateProximity(userId: string, officeId?: string): Promise<ProximityResult | null>;
  getPeersForUser(userId: string): ProximityPeer[];
  subscribeToPeerChanges(listener: (event: PeerEligibilityChangeEvent) => void): () => void;
}
