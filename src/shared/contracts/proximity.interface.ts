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
 * Proximity Service Interface (Person 2's module)
 * Injected into the presence module so the movement and presence handlers
 * can trigger spatial proximity recalculations without coupling to its internal implementation.
 */
export interface IProximityService {
  onPositionChanged(event: PositionChangedEvent): Promise<void> | void;
  onUserPresenceChanged(event: UserPresenceChangedEvent): Promise<void> | void;
  onUserLeft(userId: string, officeId: string): Promise<void> | void;
}
