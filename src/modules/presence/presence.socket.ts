import { Server, Socket } from 'socket.io';
import { IAuthService } from '../../shared/contracts/user.types';
import {
  ClientToServerEvents,
  ServerToClientEvents,
  SocketData,
} from '../../shared/contracts/presence.types';
import { PresenceService } from './presence.service';

export type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
export type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

/**
 * Configure authentication middleware and event handlers for Presence & Movement
 */
export function registerPresenceHandlers(
  io: TypedServer,
  presenceService: PresenceService,
  authService: IAuthService
): void {
  // Socket.io Authentication Middleware
  io.use(async (socket: TypedSocket, next) => {
    try {
      const auth = socket.handshake.auth as { token?: string } | undefined;
      const headers = socket.handshake.headers;
      const token =
        auth?.token ??
        (typeof headers.authorization === 'string' ? headers.authorization : undefined);

      if (!token) {
        return next(new Error('Authentication error: Missing authentication token'));
      }

      const user = await authService.verifyToken(token);
      if (!user) {
        return next(new Error('Authentication error: Invalid or expired credentials'));
      }

      socket.data.userId = user.id;
      socket.data.user = user;
      socket.data.connectedAt = Date.now();
      return next();
    } catch (err) {
      return next(new Error(`Authentication error: ${(err as Error).message}`));
    }
  });

  io.on('connection', (socket: TypedSocket) => {
    const user = socket.data.user;
    if (!user) {
      socket.disconnect(true);
      return;
    }

    // Register active connection
    presenceService.registerSocketConnection(socket.id, user);

    // Event: office:join
    socket.on('office:join', async (payload, callback) => {
      try {
        const { officeId, initialPosition } = payload;
        if (!officeId || typeof officeId !== 'string') {
          callback({ success: false, error: 'Invalid officeId', code: 'INVALID_ARGUMENT' });
          return;
        }

        const result = await presenceService.joinOffice(
          socket.id,
          user,
          officeId,
          initialPosition
        );

        if (!result.success || !result.member) {
          callback({
            success: false,
            error: result.error ?? 'Failed to join office',
            code: result.code ?? 'FORBIDDEN',
          });
          return;
        }

        const room = `office:${officeId}`;
        await socket.join(room);
        socket.data.officeId = officeId;

        // Acknowledge requester with initial snapshot
        callback({
          success: true,
          snapshot: result.snapshot,
        });

        // Notify other office members that user has joined or updated presence
        socket.to(room).emit('presence:joined', {
          officeId,
          member: result.member,
        });
      } catch (err) {
        callback({
          success: false,
          error: (err as Error).message,
          code: 'INTERNAL_ERROR',
        });
      }
    });

    // Event: avatar:move
    socket.on('avatar:move', async (payload, callback) => {
      const officeId = payload.officeId || socket.data.officeId;
      if (!officeId) {
        if (callback) {
          callback({
            success: false,
            error: 'No active office specified',
            code: 'USER_NOT_IN_OFFICE',
          });
        }
        return;
      }

      const result = await presenceService.moveAvatar(user.id, officeId, payload);

      if (!result.success || !result.position) {
        const errCode = result.code ?? 'INVALID_COORDINATES';
        const errMsg = result.error ?? 'Movement invalid';

        if (callback) {
          callback({
            success: false,
            error: errMsg,
            code: errCode,
            position: result.currentPosition,
          });
        }

        // Notify client to reconcile/snap back
        if (result.currentPosition) {
          socket.emit('avatar:move_rejected', {
            officeId,
            reason: errMsg,
            code: errCode,
            currentPosition: result.currentPosition,
          });
        }
        return;
      }

      if (callback) {
        callback({
          success: true,
          position: result.position,
        });
      }

      // Broadcast authoritative position to other members in the office
      socket.to(`office:${officeId}`).emit('avatar:moved', {
        officeId,
        userId: user.id,
        position: result.position,
      });
    });

    // Event: office:leave
    socket.on('office:leave', async (payload, callback) => {
      const officeId = payload.officeId || socket.data.officeId;
      if (!officeId) {
        if (callback) callback({ success: true });
        return;
      }

      const room = `office:${officeId}`;
      await socket.leave(room);

      const leaveResult = await presenceService.leaveOffice(socket.id, officeId);
      if (leaveResult?.userLeftOffice) {
        socket.to(room).emit('presence:left', {
          officeId,
          userId: user.id,
          reason: 'left_room',
        });
      }

      if (callback) callback({ success: true });
    });

    // Event: ping for connection keep-alive
    socket.on('presence:ping', () => {
      const officeId = (socket.data as SocketData)?.officeId;
      presenceService.touchHeartbeat(user.id, officeId);
    });

    // Socket disconnect handler
    socket.on('disconnect', async () => {
      const result = await presenceService.handleDisconnect(socket.id);
      if (result && result.isLastSocketInOffice && result.officeId) {
        io.to(`office:${result.officeId}`).emit('presence:left', {
          officeId: result.officeId,
          userId: result.userId,
          reason: 'disconnected',
        });
      }
    });
  });
}
