import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as ClientSocket, Socket as ClientSocketType } from 'socket.io-client';
import { createProxiSpeakServer, ServerInstance } from '../src/server';
import {
  ClientToServerEvents,
  ServerToClientEvents,
  PresenceSnapshot,
  AvatarPosition,
} from '../src/shared/contracts/presence.types';

type ClientTyped = ClientSocketType<ServerToClientEvents, ClientToServerEvents>;

describe('ProxiSpeak Foundation Integration Tests', () => {
  let server: ServerInstance;
  let serverPort: number;

  beforeAll(async () => {
    // Pick dynamic high port for testing
    serverPort = 48921;
    server = await createProxiSpeakServer(serverPort);
    await new Promise<void>((resolve) => {
      server.httpServer.listen(serverPort, () => resolve());
    });
  });

  afterAll(async () => {
    await server.close();
  });

  it('responds with status ok on /health endpoint', async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('ProxiSpeak Foundation');
  });

  it('rejects unauthenticated socket connections', async () => {
    const socket = ClientSocket(`http://127.0.0.1:${serverPort}`, {
      transports: ['websocket'],
      autoConnect: true,
    });

    const errorPromise = new Promise<string>((resolve) => {
      socket.on('connect_error', (err) => {
        resolve(err.message);
      });
    });

    const errorMsg = await errorPromise;
    expect(errorMsg).toContain('Authentication error');
    socket.disconnect();
  });

  it('allows authenticated clients to join an office, move avatar, and broadcast presence', async () => {
    const aliceToken = 'token-alice';
    const bobToken = 'token-bob';

    // Connect Alice
    const aliceSocket: ClientTyped = ClientSocket(`http://127.0.0.1:${serverPort}`, {
      auth: { token: aliceToken },
      transports: ['websocket'],
    });

    // Connect Bob
    const bobSocket: ClientTyped = ClientSocket(`http://127.0.0.1:${serverPort}`, {
      auth: { token: bobToken },
      transports: ['websocket'],
    });

    await Promise.all([
      new Promise<void>((resolve) => aliceSocket.on('connect', resolve)),
      new Promise<void>((resolve) => bobSocket.on('connect', resolve)),
    ]);

    // 1. Alice joins infotact-office
    const aliceJoinRes = await new Promise<{ success: boolean; snapshot?: PresenceSnapshot }>((resolve) => {
      aliceSocket.emit('office:join', { officeId: 'infotact-office' }, resolve);
    });

    expect(aliceJoinRes.success).toBe(true);
    expect(aliceJoinRes.snapshot).toBeDefined();

    // 2. Set up listener on Alice's client for Bob joining
    const bobJoinedPromise = new Promise<{ officeId: string; member: { userId: string } }>((resolve) => {
      aliceSocket.on('presence:joined', resolve);
    });

    // 3. Bob joins infotact-office
    const bobJoinRes = await new Promise<{ success: boolean; snapshot?: PresenceSnapshot }>((resolve) => {
      bobSocket.emit('office:join', { officeId: 'infotact-office' }, resolve);
    });

    expect(bobJoinRes.success).toBe(true);

    const bobJoinedEvent = await bobJoinedPromise;
    expect(bobJoinedEvent.officeId).toBe('infotact-office');
    expect(bobJoinedEvent.member.userId).toBe('user-bob');

    // 4. Bob listens for Alice's movement
    const aliceMovedPromise = new Promise<{ officeId: string; userId: string; position: AvatarPosition }>((resolve) => {
      bobSocket.on('avatar:moved', resolve);
    });

    // Alice moves avatar
    const moveRes = await new Promise<{ success: boolean; position?: AvatarPosition }>((resolve) => {
      aliceSocket.emit(
        'avatar:move',
        {
          officeId: 'infotact-office',
          x: 215,
          y: 210,
          sequence: 1,
          timestamp: Date.now(),
        },
        resolve
      );
    });

    expect(moveRes.success).toBe(true);
    expect(moveRes.position?.x).toBe(215);

    const moveBroadcast = await aliceMovedPromise;
    expect(moveBroadcast.userId).toBe('user-alice');
    expect(moveBroadcast.position.x).toBe(215);

    // Verify proximity service dependency injection was called!
    const lastProximityEvent = server.proximityService.getLastPositionEvent();
    expect(lastProximityEvent).toBeDefined();
    expect(lastProximityEvent?.userId).toBe('user-alice');
    expect(lastProximityEvent?.position.x).toBe(215);

    // 5. Test invalid movement rejection (wall collision with 'pod-1' desk at 400, 250)
    const rejectPromise = new Promise<{ reason: string; code: string }>((resolve) => {
      aliceSocket.on('avatar:move_rejected', resolve);
    });

    const badMoveRes = await new Promise<{ success: boolean; code?: string }>((resolve) => {
      aliceSocket.emit(
        'avatar:move',
        {
          officeId: 'infotact-office',
          x: 420, // Inside Engineering Desks obstacle
          y: 270,
          sequence: 2,
        },
        resolve
      );
    });

    expect(badMoveRes.success).toBe(false);
    expect(badMoveRes.code).toBe('COLLISION');

    const rejectionEvent = await rejectPromise;
    expect(rejectionEvent.code).toBe('COLLISION');

    // 6. Test disconnect cleanup
    const bobLeftPromise = new Promise<{ officeId: string; userId: string }>((resolve) => {
      aliceSocket.on('presence:left', resolve);
    });

    bobSocket.disconnect();

    const bobLeftEvent = await bobLeftPromise;
    expect(bobLeftEvent.userId).toBe('user-bob');

    // Verify signaling service received disconnect notification for WebRTC cleanup
    const signalingEvents = server.signalingService.getDisconnectedEvents();
    expect(signalingEvents.some((e) => e.userId === 'user-bob')).toBe(true);

    aliceSocket.disconnect();
  });

  it('rejects unauthorized users attempting to enter restricted offices', async () => {
    // Eve is not an executive member
    const eveSocket: ClientTyped = ClientSocket(`http://127.0.0.1:${serverPort}`, {
      auth: { token: 'token-eve' },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve) => eveSocket.on('connect', resolve));

    const joinRes = await new Promise<{ success: boolean; code?: string; error?: string }>((resolve) => {
      eveSocket.emit('office:join', { officeId: 'executive-boardroom' }, resolve);
    });

    expect(joinRes.success).toBe(false);
    expect(joinRes.code).toBe('FORBIDDEN');
    expect(joinRes.error).toContain('not authorized');

    eveSocket.disconnect();
  });
});
