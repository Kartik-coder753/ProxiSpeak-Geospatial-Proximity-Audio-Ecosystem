/**
 * Signaling Service Interface (Person 3's module)
 * Injected into the presence module so WebRTC signaling state and peer connections
 * are automatically torn down when a client leaves an office or disconnects.
 */
export interface ISignalingService {
  onUserDisconnected(params: { userId: string; officeId: string; socketId: string }): Promise<void> | void;
  onUserLeftOffice(params: { userId: string; officeId: string }): Promise<void> | void;
}
