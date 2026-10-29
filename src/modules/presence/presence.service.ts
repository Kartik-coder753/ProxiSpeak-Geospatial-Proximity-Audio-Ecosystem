import { User } from '../../shared/contracts/user.types';
import { Office } from '../../shared/contracts/office.types';
import {
  AvatarPosition,
  MoveAvatarPayload,
  PresenceSnapshot,
  PresenceUser,
} from '../../shared/contracts/presence.types';
import {
  IMembershipRepository,
  IOfficeRepository,
  IUserRepository,
} from '../../shared/contracts/repository.interfaces';
import { IProximityService } from '../../shared/contracts/proximity.interface';
import { ISignalingService } from '../../shared/contracts/signaling.interface';
import { MovementValidator } from './movement.validator';

export class PresenceService {
  // Registry: userId -> Set of active socket IDs
  private userSockets = new Map<string, Set<string>>();

  // Registry: socketId -> { userId, officeId? }
  private socketToUser = new Map<string, { userId: string; officeId?: string }>();

  // Presence State: officeId -> Map<userId, PresenceUser>
  private officePresences = new Map<string, Map<string, PresenceUser>>();

  // Registry: userId -> current officeId
  private userCurrentOffice = new Map<string, string>();

  constructor(
    private readonly userRepo: IUserRepository,
    private readonly officeRepo: IOfficeRepository,
    private readonly membershipRepo: IMembershipRepository,
    private readonly proximityService: IProximityService,
    private readonly signalingService: ISignalingService,
    private readonly movementValidator: MovementValidator = new MovementValidator()
  ) {}

  /**
   * Verify if a user is permitted to enter a designated office
   */
  async canUserEnterOffice(
    userId: string,
    officeId: string
  ): Promise<{ allowed: boolean; reason?: string; code?: string; office?: Office }> {
    const office = await this.officeRepo.findById(officeId);
    if (!office) {
      return {
        allowed: false,
        code: 'OFFICE_NOT_FOUND',
        reason: `Office '${officeId}' does not exist.`,
      };
    }

    if (office.accessPolicy === 'public') {
      return { allowed: true, office };
    }

    const isMember = await this.membershipRepo.isUserMemberOfOffice(userId, officeId);
    if (!isMember) {
      return {
        allowed: false,
        code: 'FORBIDDEN',
        reason: `User is not authorized to enter restricted office '${office.name}'.`,
      };
    }

    return { allowed: true, office };
  }

  /**
   * Register a newly connected socket associated with an authenticated user
   */
  registerSocketConnection(socketId: string, user: User): void {
    let sockets = this.userSockets.get(user.id);
    if (!sockets) {
      sockets = new Set();
      this.userSockets.set(user.id, sockets);
    }
    sockets.add(socketId);
    this.socketToUser.set(socketId, { userId: user.id });
  }

  /**
   * Join an office room and initialize/restore presence
   */
  async joinOffice(
    socketId: string,
    user: User,
    officeId: string,
    requestedPosition?: { x: number; y: number }
  ): Promise<{
    success: boolean;
    error?: string;
    code?: string;
    member?: PresenceUser;
    snapshot?: PresenceSnapshot;
    isNewToOffice: boolean;
  }> {
    const authCheck = await this.canUserEnterOffice(user.id, officeId);
    if (!authCheck.allowed || !authCheck.office) {
      return {
        success: false,
        error: authCheck.reason,
        code: authCheck.code ?? 'FORBIDDEN',
        isNewToOffice: false,
      };
    }

    const office = authCheck.office;

    // Associate socket with this office
    const socketMeta = this.socketToUser.get(socketId) ?? { userId: user.id };
    socketMeta.officeId = officeId;
    this.socketToUser.set(socketId, socketMeta);
    this.userCurrentOffice.set(user.id, officeId);

    // Get or initialize office presence map
    let members = this.officePresences.get(officeId);
    if (!members) {
      members = new Map();
      this.officePresences.set(officeId, members);
    }

    const isExisting = members.has(user.id);
    let member = members.get(user.id);

    if (!member) {
      // Choose spawn position: requested (if valid inside bounds) or default spawn
      let spawnX = requestedPosition?.x ?? office.defaultSpawnPosition.x;
      let spawnY = requestedPosition?.y ?? office.defaultSpawnPosition.y;

      // Validate initial spawn is inside bounds
      if (
        spawnX < office.bounds.minX ||
        spawnX > office.bounds.maxX ||
        spawnY < office.bounds.minY ||
        spawnY > office.bounds.maxY
      ) {
        spawnX = office.defaultSpawnPosition.x;
        spawnY = office.defaultSpawnPosition.y;
      }

      const initialPosition: AvatarPosition = {
        x: spawnX,
        y: spawnY,
        sequence: 0,
        timestamp: Date.now(),
        facing: 'down',
      };

      member = {
        userId: user.id,
        user: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
        },
        officeId,
        position: initialPosition,
        isOnline: true,
        joinedAt: Date.now(),
        lastSeenAt: Date.now(),
      };
      members.set(user.id, member);
    } else {
      // Reconnection or additional tab
      member.isOnline = true;
      member.lastSeenAt = Date.now();
    }

    // Prepare snapshot
    const snapshot = this.getOfficeSnapshot(officeId);

    // Notify proximity service via DI
    await this.proximityService.onUserPresenceChanged({
      userId: user.id,
      officeId,
      type: 'joined',
      position: member.position,
    });

    return {
      success: true,
      member,
      snapshot,
      isNewToOffice: !isExisting,
    };
  }

  /**
   * Leave an office explicitly
   */
  async leaveOffice(
    socketId: string,
    officeId: string
  ): Promise<{ userLeftOffice: boolean; userId: string; remainingSockets: number } | null> {
    const socketMeta = this.socketToUser.get(socketId);
    if (!socketMeta) return null;

    const { userId } = socketMeta;
    socketMeta.officeId = undefined;

    const userSockets = this.userSockets.get(userId) ?? new Set();

    // Check if user still has other active sockets in this office
    let hasOtherSocketInOffice = false;
    for (const sid of userSockets) {
      if (sid !== socketId) {
        const otherMeta = this.socketToUser.get(sid);
        if (otherMeta?.officeId === officeId) {
          hasOtherSocketInOffice = true;
          break;
        }
      }
    }

    if (!hasOtherSocketInOffice) {
      const officeMap = this.officePresences.get(officeId);
      if (officeMap) {
        officeMap.delete(userId);
      }
      if (this.userCurrentOffice.get(userId) === officeId) {
        this.userCurrentOffice.delete(userId);
      }

      // Notify proximity and signaling services
      await this.proximityService.onUserLeft(userId, officeId);
      await this.signalingService.onUserLeftOffice({ userId, officeId });

      return {
        userLeftOffice: true,
        userId,
        remainingSockets: userSockets.size - 1,
      };
    }

    return {
      userLeftOffice: false,
      userId,
      remainingSockets: userSockets.size,
    };
  }

  /**
   * Manage socket disconnect
   * Cleans up registry and removes presence only when the user has no remaining sockets
   */
  async handleDisconnect(
    socketId: string
  ): Promise<{
    userId: string;
    officeId?: string;
    isLastSocketInOffice: boolean;
    remainingSockets: number;
  } | null> {
    const socketMeta = this.socketToUser.get(socketId);
    if (!socketMeta) return null;

    const { userId, officeId } = socketMeta;
    this.socketToUser.delete(socketId);

    const userSockets = this.userSockets.get(userId);
    if (userSockets) {
      userSockets.delete(socketId);
      if (userSockets.size === 0) {
        this.userSockets.delete(userId);
      }
    }

    const remainingCount = userSockets?.size ?? 0;

    if (!officeId) {
      return {
        userId,
        isLastSocketInOffice: false,
        remainingSockets: remainingCount,
      };
    }

    // Check if any other socket of this user is still in this office
    let hasOtherSocketInOffice = false;
    if (userSockets && userSockets.size > 0) {
      for (const sid of userSockets) {
        const meta = this.socketToUser.get(sid);
        if (meta?.officeId === officeId) {
          hasOtherSocketInOffice = true;
          break;
        }
      }
    }

    if (!hasOtherSocketInOffice) {
      const officeMap = this.officePresences.get(officeId);
      if (officeMap) {
        officeMap.delete(userId);
      }
      if (this.userCurrentOffice.get(userId) === officeId) {
        this.userCurrentOffice.delete(userId);
      }

      // Notify proximity and signaling services via DI
      await this.proximityService.onUserLeft(userId, officeId);
      await this.signalingService.onUserDisconnected({
        userId,
        officeId,
        socketId,
      });

      return {
        userId,
        officeId,
        isLastSocketInOffice: true,
        remainingSockets: remainingCount,
      };
    }

    return {
      userId,
      officeId,
      isLastSocketInOffice: false,
      remainingSockets: remainingCount,
    };
  }

  /**
   * Authoritative movement handling
   */
  async moveAvatar(
    userId: string,
    officeId: string,
    payload: MoveAvatarPayload
  ): Promise<{
    success: boolean;
    position?: AvatarPosition;
    error?: string;
    code?: string;
    currentPosition?: AvatarPosition;
  }> {
    const office = await this.officeRepo.findById(officeId);
    if (!office) {
      return {
        success: false,
        code: 'OFFICE_NOT_FOUND',
        error: `Office '${officeId}' not found.`,
      };
    }

    const officeMap = this.officePresences.get(officeId);
    const member = officeMap?.get(userId);
    if (!member) {
      return {
        success: false,
        code: 'USER_NOT_IN_OFFICE',
        error: `User '${userId}' is not active in office '${officeId}'. Join office first.`,
      };
    }

    const currentPos = member.position;
    const validation = this.movementValidator.validateMovement(
      currentPos,
      {
        x: payload.x,
        y: payload.y,
        sequence: payload.sequence,
        timestamp: payload.timestamp,
        facing: payload.facing,
      },
      office
    );

    if (!validation.isValid || !validation.sanitizedPosition) {
      return {
        success: false,
        code: validation.code ?? 'INVALID_COORDINATES',
        error: validation.reason ?? 'Movement rejected by validator',
        currentPosition: currentPos,
      };
    }

    const previousPos = { ...member.position };
    member.position = validation.sanitizedPosition;
    member.lastSeenAt = Date.now();

    // Call proximity service via Dependency Injection
    await this.proximityService.onPositionChanged({
      userId,
      officeId,
      position: validation.sanitizedPosition,
      previousPosition: previousPos,
    });

    return {
      success: true,
      position: validation.sanitizedPosition,
    };
  }

  /**
   * Heartbeat keep-alive to refresh lastSeenAt and maintain fresh proximity state
   */
  touchHeartbeat(userId: string, officeId?: string): void {
    const targetOffice = officeId ?? this.userCurrentOffice.get(userId);
    const now = Date.now();
    if (targetOffice) {
      const officeMap = this.officePresences.get(targetOffice);
      if (officeMap) {
        const member = officeMap.get(userId);
        if (member && member.isOnline) {
          member.lastSeenAt = now;
          if (this.proximityService && (this.proximityService as any).mongoStore) {
            (this.proximityService as any).mongoStore.upsertAvatar(
              userId,
              targetOffice,
              [member.position.x, member.position.y],
              new Date(now)
            );
          }
        }
      }
    } else {
      for (const [oId, officeMap] of this.officePresences.entries()) {
        const member = officeMap.get(userId);
        if (member && member.isOnline) {
          member.lastSeenAt = now;
          if (this.proximityService && (this.proximityService as any).mongoStore) {
            (this.proximityService as any).mongoStore.upsertAvatar(
              userId,
              oId,
              [member.position.x, member.position.y],
              new Date(now)
            );
          }
        }
      }
    }
  }

  // --- Read Queries for Member 2, Member 3 and Other Modules ---

  getOnlineUsers(): string[] {
    return Array.from(this.userSockets.keys());
  }

  getUserOffice(userId: string): string | null {
    return this.userCurrentOffice.get(userId) ?? null;
  }

  getUserPosition(userId: string, officeId?: string): AvatarPosition | null {
    const targetOffice = officeId ?? this.userCurrentOffice.get(userId);
    if (!targetOffice) return null;
    const officeMap = this.officePresences.get(targetOffice);
    return officeMap?.get(userId)?.position ?? null;
  }

  getUserSockets(userId: string): string[] {
    const set = this.userSockets.get(userId);
    return set ? Array.from(set) : [];
  }

  getOfficeSnapshot(officeId: string): PresenceSnapshot {
    const map = this.officePresences.get(officeId);
    const members = map ? Array.from(map.values()) : [];
    return {
      officeId,
      members,
      timestamp: Date.now(),
    };
  }

  getAllOfficePresences(): Record<string, PresenceUser[]> {
    const res: Record<string, PresenceUser[]> = {};
    for (const [oid, map] of this.officePresences.entries()) {
      res[oid] = Array.from(map.values());
    }
    return res;
  }
}
