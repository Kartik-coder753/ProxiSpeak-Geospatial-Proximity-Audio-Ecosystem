import {
  ActiveNegotiation,
  ISignalingService,
  InboundAnswerEvent,
  InboundIceEvent,
  InboundOfferEvent,
  PeerEligibleEvent,
  PeerIneligibleEvent,
  SignalingRelayResult,
  WebRTCAnswerPayload,
  WebRTCIcePayload,
  WebRTCOfferPayload,
} from '../../shared/contracts/signaling.interface';
import {
  IPresenceReader,
  IProximityService,
  PeerEligibilityChangeEvent,
} from '../../shared/contracts/proximity.interface';

export interface RateLimiterBucket {
  offers: number[];
  answers: number[];
  iceCandidates: number[];
}

export type SocketMessageEmitter = (
  targetUserId: string,
  event: 'signal:offer' | 'signal:answer' | 'signal:ice' | 'signal:peer_eligible' | 'signal:peer_ineligible',
  payload: InboundOfferEvent | InboundAnswerEvent | InboundIceEvent | PeerEligibleEvent | PeerIneligibleEvent
) => void;

/**
 * WebRTC Signaling Service (Member 3 - Audio Signaling Owner)
 * Manages authorized SDP offer/answer relay, ICE candidate exchange,
 * proximity eligibility enforcement, negotiation IDs, collision handling, and lifecycle cleanup.
 */
export class SignalingService implements ISignalingService {
  private activeNegotiations = new Map<string, ActiveNegotiation>(); // pairKey -> ActiveNegotiation
  private rateLimits = new Map<string, RateLimiterBucket>(); // sender:target -> RateLimiterBucket
  private disconnectedEvents: Array<{ userId: string; officeId: string; socketId: string }> = [];

  constructor(
    private proximityService?: IProximityService,
    private presenceReader?: IPresenceReader,
    private socketEmitter?: SocketMessageEmitter
  ) {}

  setProximityService(service: IProximityService): void {
    this.proximityService = service;
  }

  setPresenceReader(reader: IPresenceReader): void {
    this.presenceReader = reader;
  }

  setSocketEmitter(emitter: SocketMessageEmitter): void {
    this.socketEmitter = emitter;
  }

  /**
   * Helper to compute a canonical symmetric pair key
   */
  getPairKey(userA: string, userB: string): string {
    return [userA, userB].sort().join(':');
  }

  /**
   * Determine deterministic offerer using user IDs
   */
  isDeterministicOfferer(userA: string, userB: string): boolean {
    return userA < userB;
  }

  /**
   * Check if peer pair is currently eligible according to proximity rules
   */
  isPairEligible(userA: string, userB: string): boolean {
    if (!this.proximityService) return false;
    const peersA = this.proximityService.getPeersForUser(userA);
    const peersB = this.proximityService.getPeersForUser(userB);
    return peersA.some((p) => p.userId === userB) || peersB.some((p) => p.userId === userA);
  }

  getActiveNegotiation(userA: string, userB: string): ActiveNegotiation | null {
    const key = this.getPairKey(userA, userB);
    return this.activeNegotiations.get(key) ?? null;
  }

  /**
   * Invoked when Person 2's ProximityService detects peer eligibility changes
   */
  async onPeerEligibilityChanged(event: PeerEligibilityChangeEvent): Promise<void> {
    const { userId, officeId, enteredPeers, exitedPeerIds } = event;

    // 1. Handle newly entered peers: establish clean negotiation session
    for (const peer of enteredPeers) {
      const pairKey = this.getPairKey(userId, peer.userId);
      const isOfferer = this.isDeterministicOfferer(userId, peer.userId);
      const offererUserId = isOfferer ? userId : peer.userId;
      const answererUserId = isOfferer ? peer.userId : userId;

      const negotiationId = `neg-${pairKey}-${Date.now()}`;

      const negotiation: ActiveNegotiation = {
        negotiationId,
        pairKey,
        userA: userId,
        userB: peer.userId,
        offererUserId,
        answererUserId,
        state: 'eligible',
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      };

      this.activeNegotiations.set(pairKey, negotiation);

      // Notify User A
      this.emitToUser(userId, 'signal:peer_eligible', {
        peerUserId: peer.userId,
        negotiationId,
        shouldInitiate: isOfferer,
        isPolite: !isOfferer,
      });

      // Notify User B
      this.emitToUser(peer.userId, 'signal:peer_eligible', {
        peerUserId: userId,
        negotiationId,
        shouldInitiate: !isOfferer,
        isPolite: isOfferer,
      });
    }

    // 2. Handle exited peers: close WebRTC peer connections and invalidate negotiations
    for (const exitedPeerId of exitedPeerIds) {
      this.resetPair(userId, exitedPeerId, 'out_of_range');
    }
  }

  /**
   * Handle WebRTC SDP Offer relay
   */
  async handleOffer(
    senderUserId: string,
    payload: WebRTCOfferPayload
  ): Promise<SignalingRelayResult> {
    const { targetUserId, negotiationId, sdp } = payload;

    // 1. Basic validation
    if (!targetUserId || typeof targetUserId !== 'string' || !negotiationId || !sdp) {
      return { success: false, code: 'INVALID_PAYLOAD', error: 'Invalid offer payload structure' };
    }
    if (sdp.type !== 'offer' || typeof sdp.sdp !== 'string' || !sdp.sdp.trim()) {
      return { success: false, code: 'INVALID_PAYLOAD', error: 'SDP must be a non-empty offer' };
    }

    // 2. Sender and Target Office checks
    const senderOffice = this.presenceReader?.getUserOffice(senderUserId);
    const targetOffice = this.presenceReader?.getUserOffice(targetUserId);

    if (!senderOffice || !targetOffice) {
      return { success: false, code: 'TARGET_NOT_FOUND', error: 'Target user is not active in an office' };
    }
    if (senderOffice !== targetOffice) {
      return { success: false, code: 'CROSS_OFFICE', error: 'Cross-office signaling is strictly prohibited' };
    }

    // 3. Proximity Eligibility check (Enforce Person 2's proximity rules!)
    if (!this.isPairEligible(senderUserId, targetUserId)) {
      return { success: false, code: 'NOT_ELIGIBLE', error: 'Peer is outside earshot proximity radius' };
    }

    // 4. Rate limiting check (max 5 offers per 3 seconds per pair)
    if (!this.checkRateLimit(senderUserId, targetUserId, 'offers', 5, 3000)) {
      return { success: false, code: 'RATE_LIMITED', error: 'Offer rate limit exceeded' };
    }

    // 5. Active Negotiation check
    const pairKey = this.getPairKey(senderUserId, targetUserId);
    const negotiation = this.activeNegotiations.get(pairKey);

    if (!negotiation) {
      return { success: false, code: 'STALE_NEGOTIATION', error: 'No active negotiation exists for this peer pair' };
    }

    if (negotiation.negotiationId !== negotiationId) {
      return {
        success: false,
        code: 'STALE_NEGOTIATION',
        error: `Mismatched negotiation ID. Expected '${negotiation.negotiationId}', received '${negotiationId}'`,
      };
    }

    // 6. Collision handling (WebRTC perfect negotiation)
    if (negotiation.state === 'offered') {
      if (negotiation.offererUserId === senderUserId) {
        return {
          success: false,
          code: 'OFFER_COLLISION',
          error: 'An offer is already pending answer for this negotiation',
        };
      }
      const isSenderPolite = !this.isDeterministicOfferer(senderUserId, targetUserId);
      if (!isSenderPolite) {
        // Impolite peer rejects offer collision
        return {
          success: false,
          code: 'OFFER_COLLISION',
          error: 'Simultaneous offer collision: impolite peer maintains existing offer',
        };
      }
      // Polite peer yields to collision and accepts the incoming flow
    }

    negotiation.state = 'offered';
    negotiation.offererUserId = senderUserId;
    negotiation.answererUserId = targetUserId;
    negotiation.lastActivityAt = Date.now();

    // 7. Forward authorized offer to target recipient
    const isRecipientPolite = !this.isDeterministicOfferer(targetUserId, senderUserId);
    this.emitToUser(targetUserId, 'signal:offer', {
      senderUserId,
      negotiationId,
      sdp,
      isPolite: isRecipientPolite,
    });

    return { success: true };
  }

  /**
   * Handle WebRTC SDP Answer relay
   */
  async handleAnswer(
    senderUserId: string,
    payload: WebRTCAnswerPayload
  ): Promise<SignalingRelayResult> {
    const { targetUserId, negotiationId, sdp } = payload;

    if (!targetUserId || !negotiationId || !sdp) {
      return { success: false, code: 'INVALID_PAYLOAD', error: 'Invalid answer payload structure' };
    }
    if (sdp.type !== 'answer' || typeof sdp.sdp !== 'string' || !sdp.sdp.trim()) {
      return { success: false, code: 'INVALID_PAYLOAD', error: 'SDP must be a non-empty answer' };
    }

    const senderOffice = this.presenceReader?.getUserOffice(senderUserId);
    const targetOffice = this.presenceReader?.getUserOffice(targetUserId);

    if (!senderOffice || !targetOffice || senderOffice !== targetOffice) {
      return { success: false, code: 'CROSS_OFFICE', error: 'Sender and target must be in the same office' };
    }

    if (!this.isPairEligible(senderUserId, targetUserId)) {
      return { success: false, code: 'NOT_ELIGIBLE', error: 'Peer is outside earshot proximity radius' };
    }

    if (!this.checkRateLimit(senderUserId, targetUserId, 'answers', 5, 3000)) {
      return { success: false, code: 'RATE_LIMITED', error: 'Answer rate limit exceeded' };
    }

    const pairKey = this.getPairKey(senderUserId, targetUserId);
    const negotiation = this.activeNegotiations.get(pairKey);

    if (!negotiation || negotiation.negotiationId !== negotiationId) {
      return { success: false, code: 'STALE_NEGOTIATION', error: 'Invalid or stale negotiation ID' };
    }

    if (negotiation.state !== 'offered') {
      return {
        success: false,
        code: 'STALE_NEGOTIATION',
        error: `Cannot answer negotiation in state '${negotiation.state}'`,
      };
    }

    negotiation.state = 'answered';
    negotiation.lastActivityAt = Date.now();

    // Forward answer to original offerer
    this.emitToUser(targetUserId, 'signal:answer', {
      senderUserId,
      negotiationId,
      sdp,
    });

    return { success: true };
  }

  /**
   * Handle WebRTC ICE candidate exchange
   */
  async handleIceCandidate(
    senderUserId: string,
    payload: WebRTCIcePayload
  ): Promise<SignalingRelayResult> {
    const { targetUserId, negotiationId, candidate } = payload;

    if (!targetUserId || !negotiationId || !candidate) {
      return { success: false, code: 'INVALID_PAYLOAD', error: 'Invalid ICE payload structure' };
    }

    const senderOffice = this.presenceReader?.getUserOffice(senderUserId);
    const targetOffice = this.presenceReader?.getUserOffice(targetUserId);

    if (!senderOffice || !targetOffice || senderOffice !== targetOffice) {
      return { success: false, code: 'CROSS_OFFICE', error: 'ICE candidate rejected: cross-office' };
    }

    if (!this.isPairEligible(senderUserId, targetUserId)) {
      return { success: false, code: 'NOT_ELIGIBLE', error: 'ICE candidate rejected: not within proximity' };
    }

    // Rate limit ICE candidates: max 40 per 2 seconds
    if (!this.checkRateLimit(senderUserId, targetUserId, 'iceCandidates', 40, 2000)) {
      return { success: false, code: 'RATE_LIMITED', error: 'ICE candidate rate limit exceeded' };
    }

    const pairKey = this.getPairKey(senderUserId, targetUserId);
    const negotiation = this.activeNegotiations.get(pairKey);

    if (!negotiation || negotiation.negotiationId !== negotiationId) {
      return { success: false, code: 'STALE_NEGOTIATION', error: 'ICE candidate belongs to stale negotiation' };
    }

    negotiation.lastActivityAt = Date.now();

    // Forward ICE candidate to target user
    this.emitToUser(targetUserId, 'signal:ice', {
      senderUserId,
      negotiationId,
      candidate,
    });

    return { success: true };
  }

  /**
   * Terminate active negotiation and inform clients that peer connection must be closed
   */
  resetPair(userA: string, userB: string, reason: PeerIneligibleEvent['reason']): void {
    const pairKey = this.getPairKey(userA, userB);
    const negotiation = this.activeNegotiations.get(pairKey);

    if (negotiation) {
      negotiation.state = 'closed';
      this.activeNegotiations.delete(pairKey);
    }

    this.rateLimits.delete(`${userA}:${userB}`);
    this.rateLimits.delete(`${userB}:${userA}`);

    this.emitToUser(userA, 'signal:peer_ineligible', { peerUserId: userB, reason });
    this.emitToUser(userB, 'signal:peer_ineligible', { peerUserId: userA, reason });
  }

  /**
   * Disconnect cleanup handler
   */
  async onUserDisconnected(params: { userId: string; officeId: string; socketId: string }): Promise<void> {
    this.disconnectedEvents.push(params);
    if (this.disconnectedEvents.length > 100) {
      this.disconnectedEvents.shift();
    }

    const { userId } = params;
    this.cleanupUserNegotiations(userId, 'user_disconnected');
  }

  /**
   * User leaves office cleanup handler
   */
  async onUserLeftOffice(params: { userId: string; officeId: string }): Promise<void> {
    this.disconnectedEvents.push({ ...params, socketId: 'left-office' });
    const { userId } = params;
    this.cleanupUserNegotiations(userId, 'user_left');
  }

  private cleanupUserNegotiations(userId: string, reason: PeerIneligibleEvent['reason']): void {
    for (const [pairKey, negotiation] of Array.from(this.activeNegotiations.entries())) {
      if (negotiation.userA === userId || negotiation.userB === userId) {
        const otherUserId = negotiation.userA === userId ? negotiation.userB : negotiation.userA;
        negotiation.state = 'closed';
        this.activeNegotiations.delete(pairKey);

        this.emitToUser(otherUserId, 'signal:peer_ineligible', {
          peerUserId: userId,
          reason,
        });
      }
    }
  }

  /**
   * Leaky-bucket / sliding window rate limiter
   */
  private checkRateLimit(
    sender: string,
    target: string,
    type: 'offers' | 'answers' | 'iceCandidates',
    maxCount: number,
    windowMs: number
  ): boolean {
    const key = `${sender}:${target}`;
    let bucket = this.rateLimits.get(key);
    if (!bucket) {
      bucket = { offers: [], answers: [], iceCandidates: [] };
      this.rateLimits.set(key, bucket);
    }

    const now = Date.now();
    const timestamps = bucket[type];
    // Remove expired timestamps
    while (timestamps.length > 0 && now - timestamps[0] > windowMs) {
      timestamps.shift();
    }

    if (timestamps.length >= maxCount) {
      return false;
    }

    timestamps.push(now);
    return true;
  }

  private emitToUser(
    targetUserId: string,
    event: 'signal:offer' | 'signal:answer' | 'signal:ice' | 'signal:peer_eligible' | 'signal:peer_ineligible',
    payload: InboundOfferEvent | InboundAnswerEvent | InboundIceEvent | PeerEligibleEvent | PeerIneligibleEvent
  ): void {
    if (this.socketEmitter) {
      try {
        this.socketEmitter(targetUserId, event, payload);
      } catch (err) {
        console.error(`Failed to emit ${event} to user ${targetUserId}:`, err);
      }
    }
  }

  getDisconnectedEvents(): Array<{ userId: string; officeId: string; socketId: string }> {
    return [...this.disconnectedEvents];
  }

  clear(): void {
    this.activeNegotiations.clear();
    this.rateLimits.clear();
    this.disconnectedEvents = [];
  }
}
