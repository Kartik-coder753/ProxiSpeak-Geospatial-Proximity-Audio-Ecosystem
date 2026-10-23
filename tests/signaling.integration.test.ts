import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as ClientSocket, Socket as ClientSocketType } from 'socket.io-client';
import { createProxiSpeakServer, ServerInstance } from '../src/server';
import {
  ClientToServerEvents,
  ServerToClientEvents,
} from '../src/shared/contracts/presence.types';
import {
  InboundAnswerEvent,
  InboundIceEvent,
  InboundOfferEvent,
  PeerEligibleEvent,
  PeerIneligibleEvent,
  SignalingRelayResult,
} from '../src/shared/contracts/signaling.interface';

type ClientTyped = ClientSocketType<ServerToClientEvents, ClientToServerEvents>;

describe('WebRTC Signaling End-to-End Integration Tests', () => {
  let server: ServerInstance;
  let serverPort: number;

  beforeAll(async () => {
    serverPort = 49123;
    server = await createProxiSpeakServer(serverPort);
    await new Promise<void>((resolve) => {
      server.httpServer.listen(serverPort, () => resolve());
    });
  });

  afterAll(async () => {
    await server.close();
  });

  it('coordinates full WebRTC signaling exchange when two clients enter earshot', async () => {
    const aliceSocket: ClientTyped = ClientSocket(`http://127.0.0.1:${serverPort}`, {
      auth: { token: 'token-alice' },
      transports: ['websocket'],
    });

    const bobSocket: ClientTyped = ClientSocket(`http://127.0.0.1:${serverPort}`, {
      auth: { token: 'token-bob' },
      transports: ['websocket'],
    });

    await Promise.all([
      new Promise<void>((res) => aliceSocket.on('connect', res)),
      new Promise<void>((res) => bobSocket.on('connect', res)),
    ]);

    // 1. Both join infotact-office at coordinates within 100px of each other
    // Alice spawns at (200, 200)
    await new Promise((res) => {
      aliceSocket.emit('office:join', { officeId: 'infotact-office', initialPosition: { x: 200, y: 200 } }, res);
    });

    // Bob listens for peer eligibility
    const bobEligiblePromise = new Promise<PeerEligibleEvent>((res) => {
      bobSocket.on('signal:peer_eligible', res);
    });

    // Alice listens for peer eligibility
    const aliceEligiblePromise = new Promise<PeerEligibleEvent>((res) => {
      aliceSocket.on('signal:peer_eligible', res);
    });

    // Bob spawns at (240, 200) -> Euclidean distance 40px (well within 100px earshot!)
    await new Promise((res) => {
      bobSocket.emit('office:join', { officeId: 'infotact-office', initialPosition: { x: 240, y: 200 } }, res);
    });

    const aliceEligible = await aliceEligiblePromise;
    const bobEligible = await bobEligiblePromise;

    expect(aliceEligible.peerUserId).toBe('user-bob');
    expect(bobEligible.peerUserId).toBe('user-alice');
    expect(aliceEligible.negotiationId).toBe(bobEligible.negotiationId);

    const negId = aliceEligible.negotiationId;

    // 2. Offer relay from Alice to Bob
    const bobReceivedOfferPromise = new Promise<InboundOfferEvent>((res) => {
      bobSocket.on('signal:offer', res);
    });

    const offerAck = await new Promise<SignalingRelayResult>((res) => {
      aliceSocket.emit(
        'signal:offer',
        {
          targetUserId: 'user-bob',
          negotiationId: negId,
          sdp: { type: 'offer', sdp: 'v=0\r\no=alice 1 1 IN IP4 127.0.0.1\r\ns=ProxiSpeak Audio' },
        },
        res
      );
    });

    expect(offerAck.success).toBe(true);

    const receivedOffer = await bobReceivedOfferPromise;
    expect(receivedOffer.senderUserId).toBe('user-alice');
    expect(receivedOffer.negotiationId).toBe(negId);
    expect(receivedOffer.sdp.type).toBe('offer');

    // 3. Answer relay from Bob to Alice
    const aliceReceivedAnswerPromise = new Promise<InboundAnswerEvent>((res) => {
      aliceSocket.on('signal:answer', res);
    });

    const answerAck = await new Promise<SignalingRelayResult>((res) => {
      bobSocket.emit(
        'signal:answer',
        {
          targetUserId: 'user-alice',
          negotiationId: negId,
          sdp: { type: 'answer', sdp: 'v=0\r\no=bob 2 2 IN IP4 127.0.0.1\r\ns=ProxiSpeak Audio' },
        },
        res
      );
    });

    expect(answerAck.success).toBe(true);

    const receivedAnswer = await aliceReceivedAnswerPromise;
    expect(receivedAnswer.senderUserId).toBe('user-bob');
    expect(receivedAnswer.sdp.type).toBe('answer');

    // 4. ICE candidate relay from Bob to Alice
    const aliceReceivedIcePromise = new Promise<InboundIceEvent>((res) => {
      aliceSocket.on('signal:ice', res);
    });

    const iceAck = await new Promise<SignalingRelayResult>((res) => {
      bobSocket.emit(
        'signal:ice',
        {
          targetUserId: 'user-alice',
          negotiationId: negId,
          candidate: { candidate: 'candidate:1 1 UDP 2130706431 127.0.0.1 50000 typ host' },
        },
        res
      );
    });

    expect(iceAck.success).toBe(true);

    const receivedIce = await aliceReceivedIcePromise;
    expect(receivedIce.senderUserId).toBe('user-bob');
    expect(receivedIce.candidate.candidate).toContain('50000');

    // 5. Test out-of-range exit: Bob moves beyond 110px exit hysteresis (to 350, 200) -> distance = 150px
    const alicePeerIneligiblePromise = new Promise<PeerIneligibleEvent>((res) => {
      aliceSocket.on('signal:peer_ineligible', res);
    });

    await new Promise((res) => {
      bobSocket.emit(
        'avatar:move',
        {
          officeId: 'infotact-office',
          x: 350,
          y: 200,
          sequence: 2,
        },
        res
      );
    });

    const ineligibleEvent = await alicePeerIneligiblePromise;
    expect(ineligibleEvent.peerUserId).toBe('user-bob');
    expect(ineligibleEvent.reason).toBe('out_of_range');

    // 6. Verify subsequent offers are rejected now that they are out of range
    const rejectedOffer = await new Promise<SignalingRelayResult>((res) => {
      aliceSocket.emit(
        'signal:offer',
        {
          targetUserId: 'user-bob',
          negotiationId: negId,
          sdp: { type: 'offer', sdp: 'v=0...' },
        },
        res
      );
    });

    expect(rejectedOffer.success).toBe(false);
    expect(rejectedOffer.code).toBe('NOT_ELIGIBLE');

    aliceSocket.disconnect();
    bobSocket.disconnect();
  });
});
