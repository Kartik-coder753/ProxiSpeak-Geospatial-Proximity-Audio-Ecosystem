import { describe, it, expect, beforeEach } from 'vitest';
import { SignalingService } from '../src/modules/signaling/signaling.service';
import { IPresenceReader, IProximityService, ProximityPeer } from '../src/shared/contracts/proximity.interface';
import { InboundAnswerEvent, InboundIceEvent, InboundOfferEvent, PeerEligibleEvent, PeerIneligibleEvent } from '../src/shared/contracts/signaling.interface';

describe('SignalingService Unit Tests', () => {
  let signalingService: SignalingService;
  let mockPresenceReader: IPresenceReader;
  let mockProximityService: IProximityService;

  let activeUsers: Map<string, { officeId: string; isOnline: boolean }>;
  let eligiblePeers: Map<string, ProximityPeer[]>;
  let emittedMessages: Array<{ targetUserId: string; event: string; payload: unknown }>;

  beforeEach(() => {
    activeUsers = new Map([
      ['alice', { officeId: 'infotact-office', isOnline: true }],
      ['bob', { officeId: 'infotact-office', isOnline: true }],
      ['charlie', { officeId: 'executive-boardroom', isOnline: true }], // Different office
      ['offline-dan', { officeId: 'infotact-office', isOnline: false }],
    ]);

    eligiblePeers = new Map([
      ['alice', [{ userId: 'bob', distance: 50 }]],
      ['bob', [{ userId: 'alice', distance: 50 }]],
    ]);

    emittedMessages = [];

    mockPresenceReader = {
      getUserPosition() {
        return { x: 100, y: 100, sequence: 1, timestamp: Date.now() };
      },
      getUserOffice(userId: string) {
        return activeUsers.get(userId)?.officeId ?? null;
      },
      getOfficeSnapshot(officeId: string) {
        const members = Array.from(activeUsers.entries())
          .filter(([, u]) => u.officeId === officeId)
          .map(([userId, u]) => ({
            userId,
            position: { x: 100, y: 100, sequence: 1, timestamp: Date.now() },
            isOnline: u.isOnline,
            lastSeenAt: Date.now(),
          }));
        return { members };
      },
      getOnlineUsers() {
        return Array.from(activeUsers.entries())
          .filter(([, u]) => u.isOnline)
          .map(([u]) => u);
      },
    };

    mockProximityService = {
      async onPositionChanged() { return null; },
      async onUserPresenceChanged() {},
      async onUserLeft() {},
      async calculateProximity() {
        return null;
      },
      getPeersForUser(userId: string) {
        return eligiblePeers.get(userId) ?? [];
      },
      subscribeToPeerChanges() {
        return () => {};
      },
    };

    signalingService = new SignalingService(
      mockProximityService,
      mockPresenceReader,
      (targetUserId, event, payload) => {
        emittedMessages.push({ targetUserId, event, payload });
      }
    );
  });

  it('triggers peer eligibility negotiation when users enter proximity earshot', async () => {
    // Proximity detected Alice and Bob are peers
    await signalingService.onPeerEligibilityChanged({
      userId: 'alice',
      officeId: 'infotact-office',
      enteredPeers: [{ userId: 'bob', distance: 65 }],
      exitedPeerIds: [],
      currentPeers: [{ userId: 'bob', distance: 65 }],
      calculatedAt: Date.now(),
    });

    const negotiation = signalingService.getActiveNegotiation('alice', 'bob');
    expect(negotiation).not.toBeNull();
    expect(negotiation?.offererUserId).toBe('alice'); // 'alice' < 'bob' deterministic tie breaker
    expect(negotiation?.answererUserId).toBe('bob');

    // Both users should have received signal:peer_eligible events
    const aliceEligible = emittedMessages.find(
      (m) => m.targetUserId === 'alice' && m.event === 'signal:peer_eligible'
    )?.payload as PeerEligibleEvent;
    expect(aliceEligible).toBeDefined();
    expect(aliceEligible.peerUserId).toBe('bob');
    expect(aliceEligible.shouldInitiate).toBe(true);

    const bobEligible = emittedMessages.find(
      (m) => m.targetUserId === 'bob' && m.event === 'signal:peer_eligible'
    )?.payload as PeerEligibleEvent;
    expect(bobEligible).toBeDefined();
    expect(bobEligible.peerUserId).toBe('alice');
    expect(bobEligible.shouldInitiate).toBe(false);
    expect(bobEligible.isPolite).toBe(true);
  });

  it('relays valid SDP offer, answer and ICE candidates between authorized peers', async () => {
    // Establish negotiation session
    await signalingService.onPeerEligibilityChanged({
      userId: 'alice',
      officeId: 'infotact-office',
      enteredPeers: [{ userId: 'bob', distance: 50 }],
      exitedPeerIds: [],
      currentPeers: [{ userId: 'bob', distance: 50 }],
      calculatedAt: Date.now(),
    });

    const negotiation = signalingService.getActiveNegotiation('alice', 'bob')!;
    const negId = negotiation.negotiationId;

    // 1. Alice sends offer
    const offerRes = await signalingService.handleOffer('alice', {
      targetUserId: 'bob',
      negotiationId: negId,
      sdp: { type: 'offer', sdp: 'v=0\r\no=alice 123 456 IN IP4 127.0.0.1' },
    });
    expect(offerRes.success).toBe(true);

    // Verify Bob received the offer
    const forwardedOffer = emittedMessages.find(
      (m) => m.targetUserId === 'bob' && m.event === 'signal:offer'
    )?.payload as InboundOfferEvent;
    expect(forwardedOffer).toBeDefined();
    expect(forwardedOffer.senderUserId).toBe('alice');
    expect(forwardedOffer.negotiationId).toBe(negId);

    // 2. Bob sends answer
    const answerRes = await signalingService.handleAnswer('bob', {
      targetUserId: 'alice',
      negotiationId: negId,
      sdp: { type: 'answer', sdp: 'v=0\r\no=bob 789 101 IN IP4 127.0.0.1' },
    });
    expect(answerRes.success).toBe(true);

    // Verify Alice received the answer
    const forwardedAnswer = emittedMessages.find(
      (m) => m.targetUserId === 'alice' && m.event === 'signal:answer'
    )?.payload as InboundAnswerEvent;
    expect(forwardedAnswer).toBeDefined();
    expect(forwardedAnswer.senderUserId).toBe('bob');
    expect(forwardedAnswer.sdp.type).toBe('answer');

    // 3. Alice and Bob exchange ICE candidates
    const iceRes = await signalingService.handleIceCandidate('alice', {
      targetUserId: 'bob',
      negotiationId: negId,
      candidate: { candidate: 'candidate:1 1 UDP 2130706431 127.0.0.1 50000 typ host', sdpMid: '0', sdpMLineIndex: 0 },
    });
    expect(iceRes.success).toBe(true);

    const forwardedIce = emittedMessages.find(
      (m) => m.targetUserId === 'bob' && m.event === 'signal:ice'
    )?.payload as InboundIceEvent;
    expect(forwardedIce).toBeDefined();
    expect(forwardedIce.senderUserId).toBe('alice');
    expect(forwardedIce.candidate.sdpMid).toBe('0');
  });

  it('rejects cross-office signaling attempts', async () => {
    // Charlie is in 'executive-boardroom', Alice is in 'infotact-office'
    const result = await signalingService.handleOffer('alice', {
      targetUserId: 'charlie',
      negotiationId: 'neg-123',
      sdp: { type: 'offer', sdp: 'dummy-sdp' },
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('CROSS_OFFICE');
  });

  it('rejects signaling from users outside earshot proximity radius', async () => {
    // Dan is not in Alice's proximity list
    activeUsers.set('dan', { officeId: 'infotact-office', isOnline: true });

    const result = await signalingService.handleOffer('alice', {
      targetUserId: 'dan',
      negotiationId: 'neg-123',
      sdp: { type: 'offer', sdp: 'dummy-sdp' },
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('NOT_ELIGIBLE');
    expect(result.error).toContain('outside earshot');
  });

  it('rejects stale or mismatched negotiation IDs', async () => {
    await signalingService.onPeerEligibilityChanged({
      userId: 'alice',
      officeId: 'infotact-office',
      enteredPeers: [{ userId: 'bob', distance: 50 }],
      exitedPeerIds: [],
      currentPeers: [{ userId: 'bob', distance: 50 }],
      calculatedAt: Date.now(),
    });

    const result = await signalingService.handleOffer('alice', {
      targetUserId: 'bob',
      negotiationId: 'stale-old-negotiation-999',
      sdp: { type: 'offer', sdp: 'dummy-sdp' },
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('STALE_NEGOTIATION');
  });

  it('handles simultaneous offer collision according to deterministic polite/impolite policy', async () => {
    await signalingService.onPeerEligibilityChanged({
      userId: 'alice',
      officeId: 'infotact-office',
      enteredPeers: [{ userId: 'bob', distance: 50 }],
      exitedPeerIds: [],
      currentPeers: [{ userId: 'bob', distance: 50 }],
      calculatedAt: Date.now(),
    });

    const negotiation = signalingService.getActiveNegotiation('alice', 'bob')!;
    const negId = negotiation.negotiationId;

    // Alice (impolite, 'alice' < 'bob') sends an offer
    const offerAlice = await signalingService.handleOffer('alice', {
      targetUserId: 'bob',
      negotiationId: negId,
      sdp: { type: 'offer', sdp: 'sdp-from-alice' },
    });
    expect(offerAlice.success).toBe(true);

    // Now Alice attempts to send a second conflicting offer before answer is received
    const secondOfferFromAlice = await signalingService.handleOffer('alice', {
      targetUserId: 'bob',
      negotiationId: negId,
      sdp: { type: 'offer', sdp: 'sdp-from-alice-2' },
    });
    // Collision check: impolite peer maintains state or yields if polite
    expect(secondOfferFromAlice.success).toBe(false);
    expect(secondOfferFromAlice.code).toBe('OFFER_COLLISION');
  });

  it('enforces rate limiting on excessive signaling attempts', async () => {
    await signalingService.onPeerEligibilityChanged({
      userId: 'alice',
      officeId: 'infotact-office',
      enteredPeers: [{ userId: 'bob', distance: 50 }],
      exitedPeerIds: [],
      currentPeers: [{ userId: 'bob', distance: 50 }],
      calculatedAt: Date.now(),
    });

    const negotiation = signalingService.getActiveNegotiation('alice', 'bob')!;
    const negId = negotiation.negotiationId;

    // Send 50 ICE candidates in rapid succession
    let rateLimited = false;
    for (let i = 0; i < 50; i++) {
      const res = await signalingService.handleIceCandidate('alice', {
        targetUserId: 'bob',
        negotiationId: negId,
        candidate: { candidate: `cand-${i}`, sdpMid: '0', sdpMLineIndex: 0 },
      });
      if (!res.success && res.code === 'RATE_LIMITED') {
        rateLimited = true;
        break;
      }
    }

    expect(rateLimited).toBe(true);
  });

  it('cleans up negotiations and notifies peers when a user disconnects or leaves office', async () => {
    await signalingService.onPeerEligibilityChanged({
      userId: 'alice',
      officeId: 'infotact-office',
      enteredPeers: [{ userId: 'bob', distance: 50 }],
      exitedPeerIds: [],
      currentPeers: [{ userId: 'bob', distance: 50 }],
      calculatedAt: Date.now(),
    });

    expect(signalingService.getActiveNegotiation('alice', 'bob')).not.toBeNull();

    // Alice disconnects
    await signalingService.onUserDisconnected({
      userId: 'alice',
      officeId: 'infotact-office',
      socketId: 'sock-alice-1',
    });

    // Negotiation must be wiped
    expect(signalingService.getActiveNegotiation('alice', 'bob')).toBeNull();

    // Bob must receive peer_ineligible event
    const bobIneligible = emittedMessages.find(
      (m) => m.targetUserId === 'bob' && m.event === 'signal:peer_ineligible'
    )?.payload as PeerIneligibleEvent;
    expect(bobIneligible).toBeDefined();
    expect(bobIneligible.peerUserId).toBe('alice');
    expect(bobIneligible.reason).toBe('user_disconnected');
  });
});
