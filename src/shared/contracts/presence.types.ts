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
  user: Pick<User, 'id' | 'username' | 'displayName' | 'avatarUrl'>;
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

export interface ServerToClientEvents {
  'presence:snapshot': (snapshot: PresenceSnapshot) => void;
  'presence:joined': (data: { officeId: string; member: PresenceUser }) => void;
  'presence:left': (data: { officeId: string; userId: string; reason?: string }) => void;
  'avatar:moved': (data: { officeId: string; userId: string; position: AvatarPosition }) => void;
  'avatar:move_rejected': (data: { officeId: string; reason: string; code: string; currentPosition: AvatarPosition }) => void;
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
  'presence:ping': () => void;
}

export interface SocketData {
  userId: string;
  user: User;
  officeId?: string;
  connectedAt: number;
}
