import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as ClientSocket, Socket as ClientSocketType } from 'socket.io-client';
import { createProxiSpeakServer, ServerInstance } from '../src/server';
import { ClientToServerEvents, ServerToClientEvents } from '../src/shared/contracts/presence.types';
import { PeerEligibleEvent, PeerIneligibleEvent } from '../src/shared/contracts/signaling.interface';

type ClientTyped = ClientSocketType<ServerToClientEvents, ClientToServerEvents>;

describe('ProxiSpeak Master Cross-Module Integration QA Suite (Person 4)', () => {
  let server: ServerInstance;
  let serverPort: number;

  beforeAll(async () => {
    serverPort = 49400;
    server = await createProxiSpeakServer(serverPort);
    await new Promise<void>((resolve) => {
      server.httpServer.listen(serverPort, () => resolve());
    });
  });

  afterAll(async () => {
    await server.close();
  });

  it('verifies two users joining the same office receive mutual presence and live snapshot', async () => {
    const aliceSocket: ClientTyped = ClientSocket(`http://127.0.0.1:${serverPort}`, {
      auth: { token: 'token-alice' },
      transports: ['websocket'],
    });

    const bobSocket: ClientTyped = ClientSocket(`http://127.0.0.1:${serverPort}`, {
      auth: { token: 'token-bob' },
      transports: ['websocket'],
    });

    await Promise.all([
      new Promise<void>((r) => aliceSocket.on('connect', r)),
      new Promise<void>((r) => bobSocket.on('connect', r)),
    ]);

    // Alice joins infotact-office
    const aliceJoin = await new Promise<{ success: boolean; snapshot?: { members: Array<{ userId: string }> } }>((res) => {
      aliceSocket.emit('office:join', { officeId: 'infotact-office' }, res);
    });
    expect(aliceJoin.success).toBe(true);

    // Bob joins infotact-office and receives snapshot containing Alice
    const bobJoin = await new Promise<{ success: boolean; snapshot?: { members: Array<{ userId: string }> } }>((res) => {
      bobSocket.emit('office:join', { officeId: 'infotact-office' }, res);
    });
    expect(bobJoin.success).toBe(true);
    expect(bobJoin.snapshot?.members.some((m) => m.userId === 'user-alice')).toBe(true);

    aliceSocket.disconnect();
    bobSocket.disconnect();
  });

  it('enforces office isolation: users in separate offices never receive peer eligibility or signaling', async () => {
    const aliceSocket: ClientTyped = ClientSocket(`http://127.0.0.1:${serverPort}`, {
      auth: { token: 'token-alice' },
      transports: ['websocket'],
    });

    // Eve joins public-townhall
    const eveSocket: ClientTyped = ClientSocket(`http://127.0.0.1:${serverPort}`, {
      auth: { token: 'token-eve' },
      transports: ['websocket'],
    });

    await Promise.all([
      new Promise<void>((r) => aliceSocket.on('connect', r)),
      new Promise<void>((r) => eveSocket.on('connect', r)),
    ]);

    // Alice at (200, 200) in infotact-office
    await new Promise((res) => aliceSocket.emit('office:join', { officeId: 'infotact-office', initialPosition: { x: 200, y: 200 } }, res));

    // Eve at (200, 200) in public-townhall (exact same coordinates, different office!)
    await new Promise((res) => eveSocket.emit('office:join', { officeId: 'public-townhall', initialPosition: { x: 200, y: 200 } }, res));

    // Neither user should ever receive peer eligibility for the other
    const alicePeers = server.proximityService.getPeersForUser('user-alice');
    expect(alicePeers.some((p) => p.userId === 'user-eve')).toBe(false);

    aliceSocket.disconnect();
    eveSocket.disconnect();
  });

  it('evaluates sound occlusion when a solid wall blocks line of sight between two avatars', async () => {
    // In infotact-office, Conference Partition wall is from x=800, y=100..480 (blocksSound: true, attenuation: 0)
    const office = await server.officeService.getOfficeLayout('infotact-office');
    expect(office).not.toBeNull();

    // Alice at (750, 250) (inside meeting pod) and Bob at (850, 250) (outside in corridor)
    const occlusion = server.geometryService.checkSoundObstruction(
      { x: 750, y: 250 },
      { x: 850, y: 250 },
      office!.obstacles
    );

    // Audio must be occluded / blocked
    expect(occlusion.isBlocked).toBe(true);
    expect(occlusion.totalTransmission).toBe(0);
    expect(occlusion.intersectingObstacles.some((o) => o.id === 'partition-wall')).toBe(true);
  });

  it('persists office layout updates through the authorized API and increments version', async () => {
    // Alice (admin) updates layout via HTTP PUT
    const res = await fetch(`http://127.0.0.1:${serverPort}/api/offices/infotact-office/layout`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'token-alice',
      },
      body: JSON.stringify({
        width: 1300,
        height: 850,
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.layout.layoutVersion).toBeGreaterThan(1);

    // Verify GET returns updated persisted layout
    const getRes = await fetch(`http://127.0.0.1:${serverPort}/api/offices/infotact-office/layout`);
    expect(getRes.status).toBe(200);
    const layout = await getRes.json();
    expect(layout.width).toBe(1300);
  });

  it('tears down WebRTC peer negotiation when a user disconnects mid-session', async () => {
    const aliceSocket: ClientTyped = ClientSocket(`http://127.0.0.1:${serverPort}`, {
      auth: { token: 'token-alice' },
      transports: ['websocket'],
    });

    const bobSocket: ClientTyped = ClientSocket(`http://127.0.0.1:${serverPort}`, {
      auth: { token: 'token-bob' },
      transports: ['websocket'],
    });

    await Promise.all([
      new Promise<void>((r) => aliceSocket.on('connect', r)),
      new Promise<void>((r) => bobSocket.on('connect', r)),
    ]);

    // Alice and Bob join within earshot
    await new Promise((r) => aliceSocket.emit('office:join', { officeId: 'infotact-office', initialPosition: { x: 200, y: 200 } }, r));

    const bobEligiblePromise = new Promise<PeerEligibleEvent>((r) => bobSocket.on('signal:peer_eligible', r));
    await new Promise((r) => bobSocket.emit('office:join', { officeId: 'infotact-office', initialPosition: { x: 230, y: 200 } }, r));

    await bobEligiblePromise;

    // Bob listens for peer ineligible upon Alice disconnect
    const bobIneligiblePromise = new Promise<PeerIneligibleEvent>((r) => bobSocket.on('signal:peer_ineligible', r));

    // Alice abruptly disconnects
    aliceSocket.disconnect();

    const ineligibleEvent = await bobIneligiblePromise;
    expect(ineligibleEvent.peerUserId).toBe('user-alice');
    expect(['user_disconnected', 'out_of_range']).toContain(ineligibleEvent.reason);

    bobSocket.disconnect();
  });
});
