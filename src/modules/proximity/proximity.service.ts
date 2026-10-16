import {
  IProximityService,
  PositionChangedEvent,
  UserPresenceChangedEvent,
} from '../../shared/contracts/proximity.interface';

/**
 * Proximity Service Foundation
 * Handles proximity notifications dispatched from PresenceService.
 * Can be replaced or extended by Person 2 with spatial indexing / audio attenuation algorithms.
 */
export class ProximityService implements IProximityService {
  private lastPositionEvents: PositionChangedEvent[] = [];
  private presenceEvents: UserPresenceChangedEvent[] = [];

  async onPositionChanged(event: PositionChangedEvent): Promise<void> {
    this.lastPositionEvents.push(event);
    if (this.lastPositionEvents.length > 100) {
      this.lastPositionEvents.shift();
    }
  }

  async onUserPresenceChanged(event: UserPresenceChangedEvent): Promise<void> {
    this.presenceEvents.push(event);
    if (this.presenceEvents.length > 100) {
      this.presenceEvents.shift();
    }
  }

  async onUserLeft(userId: string, officeId: string): Promise<void> {
    this.presenceEvents.push({
      userId,
      officeId,
      type: 'left',
    });
  }

  // Diagnostic helpers for testing integration
  getLastPositionEvent(): PositionChangedEvent | undefined {
    return this.lastPositionEvents[this.lastPositionEvents.length - 1];
  }

  getPresenceEvents(): UserPresenceChangedEvent[] {
    return [...this.presenceEvents];
  }

  clear(): void {
    this.lastPositionEvents = [];
    this.presenceEvents = [];
  }
}
