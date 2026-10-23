import { PeerEligibilityChangeEvent } from './proximity.interface';

export interface RTCSessionDescriptionInitLike {
  type: 'offer' | 'answer' | 'pranswer' | 'rollback';
  sdp?: string;
}

export interface RTCIceCandidateInitLike {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export interface WebRTCOfferPayload {
  targetUserId: string;
  negotiationId: string;
  sdp: RTCSessionDescriptionInitLike;
}

export interface WebRTCAnswerPayload {
  targetUserId: string;
  negotiationId: string;
  sdp: RTCSessionDescriptionInitLike;
}

export interface WebRTCIcePayload {
  targetUserId: string;
  negotiationId: string;
  candidate: RTCIceCandidateInitLike;
}

export interface InboundOfferEvent {
  senderUserId: string;
  negotiationId: string;
  sdp: RTCSessionDescriptionInitLike;
  isPolite: boolean;
}

export interface InboundAnswerEvent {
  senderUserId: string;
  negotiationId: string;
  sdp: RTCSessionDescriptionInitLike;
}

export interface InboundIceEvent {
  senderUserId: string;
  negotiationId: string;
  candidate: RTCIceCandidateInitLike;
}

export interface PeerEligibleEvent {
  peerUserId: string;
  negotiationId: string;
  shouldInitiate: boolean;
  isPolite: boolean;
}

export interface PeerIneligibleEvent {
  peerUserId: string;
  reason: 'out_of_range' | 'user_left' | 'user_disconnected';
}

export type SignalingErrorCode =
  | 'UNAUTHENTICATED'
  | 'TARGET_NOT_FOUND'
  | 'CROSS_OFFICE'
  | 'NOT_ELIGIBLE'
  | 'STALE_NEGOTIATION'
  | 'RATE_LIMITED'
  | 'INVALID_PAYLOAD'
  | 'OFFER_COLLISION';

export interface SignalingRelayResult {
  success: boolean;
  code?: SignalingErrorCode;
  error?: string;
}

export interface ActiveNegotiation {
  negotiationId: string;
  pairKey: string;
  userA: string;
  userB: string;
  offererUserId: string;
  answererUserId: string;
  state: 'eligible' | 'offered' | 'answered' | 'connected' | 'closed';
  createdAt: number;
  lastActivityAt: number;
}

/**
 * Signaling Service Interface (Person 3's module)
 * Injected into the presence & proximity modules so WebRTC signaling state and peer connections
 * are authorized, routed, and torn down when peers enter or leave proximity earshot.
 */
export interface ISignalingService {
  onUserDisconnected(params: { userId: string; officeId: string; socketId: string }): Promise<void> | void;
  onUserLeftOffice(params: { userId: string; officeId: string }): Promise<void> | void;
  onPeerEligibilityChanged(event: PeerEligibilityChangeEvent): Promise<void> | void;

  handleOffer(
    senderUserId: string,
    payload: WebRTCOfferPayload
  ): Promise<SignalingRelayResult>;

  handleAnswer(
    senderUserId: string,
    payload: WebRTCAnswerPayload
  ): Promise<SignalingRelayResult>;

  handleIceCandidate(
    senderUserId: string,
    payload: WebRTCIcePayload
  ): Promise<SignalingRelayResult>;

  isPairEligible(userA: string, userB: string): boolean;
  getActiveNegotiation(userA: string, userB: string): ActiveNegotiation | null;
  resetPair(userA: string, userB: string, reason: PeerIneligibleEvent['reason']): void;
}
