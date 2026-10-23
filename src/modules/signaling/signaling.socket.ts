import { TypedServer, TypedSocket } from '../presence/presence.socket';
import { SignalingService } from './signaling.service';
import { PresenceService } from '../presence/presence.service';

/**
 * Register WebRTC signaling event handlers on the Socket.io server
 */
export function registerSignalingHandlers(
  io: TypedServer,
  signalingService: SignalingService,
  presenceService: PresenceService
): void {
  // Wire up the socket emitter for outbound signaling messages to recipients
  signalingService.setSocketEmitter((targetUserId, event, payload) => {
    const socketIds = presenceService.getUserSockets(targetUserId);
    for (const sid of socketIds) {
      io.to(sid).emit(event as any, payload as any);
    }
  });

  io.on('connection', (socket: TypedSocket) => {
    const user = socket.data.user;
    if (!user) return;

    // WebRTC Offer
    socket.on('signal:offer', async (payload, callback) => {
      try {
        // Authoritative sender ID from authenticated socket
        const senderUserId = socket.data.userId;
        const result = await signalingService.handleOffer(senderUserId, payload);
        if (callback) callback(result);
      } catch (err) {
        if (callback) {
          callback({
            success: false,
            code: 'INVALID_PAYLOAD',
            error: (err as Error).message,
          });
        }
      }
    });

    // WebRTC Answer
    socket.on('signal:answer', async (payload, callback) => {
      try {
        const senderUserId = socket.data.userId;
        const result = await signalingService.handleAnswer(senderUserId, payload);
        if (callback) callback(result);
      } catch (err) {
        if (callback) {
          callback({
            success: false,
            code: 'INVALID_PAYLOAD',
            error: (err as Error).message,
          });
        }
      }
    });

    // WebRTC ICE Candidate
    socket.on('signal:ice', async (payload, callback) => {
      try {
        const senderUserId = socket.data.userId;
        const result = await signalingService.handleIceCandidate(senderUserId, payload);
        if (callback) callback(result);
      } catch (err) {
        if (callback) {
          callback({
            success: false,
            code: 'INVALID_PAYLOAD',
            error: (err as Error).message,
          });
        }
      }
    });
  });
}
