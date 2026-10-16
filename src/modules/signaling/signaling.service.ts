import { ISignalingService } from '../../shared/contracts/signaling.interface';

/**
 * Signaling Service Foundation
 * Handles WebRTC connection lifecycle events dispatched from PresenceService.
 * Can be extended by Person 3 with ICE/SDP peer negotiation.
 */
export class SignalingService implements ISignalingService {
  private disconnectedEvents: Array<{ userId: string; officeId: string; socketId: string }> = [];

  async onUserDisconnected(params: { userId: string; officeId: string; socketId: string }): Promise<void> {
    this.disconnectedEvents.push(params);
    if (this.disconnectedEvents.length > 100) {
      this.disconnectedEvents.shift();
    }
  }

  async onUserLeftOffice(params: { userId: string; officeId: string }): Promise<void> {
    this.disconnectedEvents.push({ ...params, socketId: 'left-office' });
  }

  getDisconnectedEvents(): Array<{ userId: string; officeId: string; socketId: string }> {
    return [...this.disconnectedEvents];
  }

  clear(): void {
    this.disconnectedEvents = [];
  }
}
