import { ProximityPeer } from './proximity.interface';
import { User } from './user.types';

export type FacingDirection = 'up' | 'down' | 'left' | 'right';

export interface AvatarPosition {
  x: number;
  y: number;
  sequence: number;
  timestamp: number;
  facing?: FacingDirection;
}

export interface PresenceUser {
  userId: string;
  user: Pick<User, 'id' | 'username' | 'displayName' | 'avatarUrl' | 'themeColor' | 'roleTitle' | 'badge'>;
  officeId: string;
  position: AvatarPosition;
  isOnline: boolean;
  joinedAt: number;
  lastSeenAt: number;
}

export interface PresenceSnapshot {
  officeId: string;
  members: PresenceUser[];
  timestamp: number;
}

export interface JoinOfficePayload {
  officeId: string;
  initialPosition?: { x: number; y: number };
}

export interface MoveAvatarPayload {
  officeId: string;
  x: number;
  y: number;
  sequence: number;
  timestamp?: number;
  facing?: FacingDirection;
}

export interface MoveValidationResult {
  isValid: boolean;
  code?: 'INVALID_COORDINATES' | 'OUT_OF_BOUNDS' | 'COLLISION' | 'SPEED_EXCEEDED' | 'STALE_SEQUENCE' | 'USER_NOT_IN_OFFICE';
  reason?: string;
  sanitizedPosition?: AvatarPosition;
}

import {
  InboundAnswerEvent,
  InboundIceEvent,
  InboundOfferEvent,
  PeerEligibleEvent,
  PeerIneligibleEvent,
  SignalingRelayResult,
  WebRTCAnswerPayload,
  WebRTCIcePayload,
  WebRTCOfferPayload,
} from './signaling.interface';

export interface ServerToClientEvents {
  'presence:snapshot': (snapshot: PresenceSnapshot) => void;
  'presence:joined': (data: { officeId: string; member: PresenceUser }) => void;
  'presence:left': (data: { officeId: string; userId: string; reason?: string }) => void;
  'avatar:moved': (data: { officeId: string; userId: string; position: AvatarPosition }) => void;
  'avatar:move_rejected': (data: { officeId: string; reason: string; code: string; currentPosition: AvatarPosition }) => void;
  'proximity:update': (data: { officeId: string; peers: ProximityPeer[] }) => void;
  'signal:offer': (data: InboundOfferEvent) => void;
  'signal:answer': (data: InboundAnswerEvent) => void;
  'signal:ice': (data: InboundIceEvent) => void;
  'signal:peer_eligible': (data: PeerEligibleEvent) => void;
  'signal:peer_ineligible': (data: PeerIneligibleEvent) => void;
  'error': (data: { message: string; code?: string }) => void;
}

export interface ClientToServerEvents {
  'office:join': (
    payload: JoinOfficePayload,
    callback: (response: { success: boolean; error?: string; code?: string; snapshot?: PresenceSnapshot }) => void
  ) => void;
  'office:leave': (
    payload: { officeId: string },
    callback?: (response: { success: boolean; error?: string }) => void
  ) => void;
  'avatar:move': (
    payload: MoveAvatarPayload,
    callback?: (response: { success: boolean; error?: string; code?: string; position?: AvatarPosition }) => void
  ) => void;
  'signal:offer': (
    payload: WebRTCOfferPayload,
    callback?: (response: SignalingRelayResult) => void
  ) => void;
  'signal:answer': (
    payload: WebRTCAnswerPayload,
    callback?: (response: SignalingRelayResult) => void
  ) => void;
  'signal:ice': (
    payload: WebRTCIcePayload,
    callback?: (response: SignalingRelayResult) => void
  ) => void;
  'presence:ping': () => void;
}

export interface SocketData {
  userId: string;
  user: User;
  officeId?: string;
  connectedAt: number;
}
