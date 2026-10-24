import { AvatarPosition, FacingDirection, MoveValidationResult } from '../../shared/contracts/presence.types';
import { Office, RectObstacle } from '../../shared/contracts/office.types';
import { GeometryService } from '../offices/geometry.service';

export interface MovementValidatorConfig {
  maxSpeedPixelsPerSecond: number;
  maxTeleportDistance: number;
  avatarRadius: number;
  allowGracePeriodMs: number;
}

export const DEFAULT_MOVEMENT_CONFIG: MovementValidatorConfig = {
  maxSpeedPixelsPerSecond: 600, // 600 px/sec allows responsive sprint
  maxTeleportDistance: 250,      // Max allowed jump in a single tick
  avatarRadius: 12,              // Avatar collision radius
  allowGracePeriodMs: 50,
};

export class MovementValidator {
  constructor(
    private readonly config: MovementValidatorConfig = DEFAULT_MOVEMENT_CONFIG,
    private readonly geometryService: GeometryService = new GeometryService()
  ) {}

  /**
   * Authoritative validation of avatar movement updates.
   */
  validateMovement(
    currentPosition: AvatarPosition,
    target: { x: number; y: number; sequence: number; timestamp?: number; facing?: FacingDirection },
    office: Office
  ): MoveValidationResult {
    // 1. Coordinate check: Must be finite numbers
    if (
      typeof target.x !== 'number' ||
      typeof target.y !== 'number' ||
      !Number.isFinite(target.x) ||
      !Number.isFinite(target.y)
    ) {
      return {
        isValid: false,
        code: 'INVALID_COORDINATES',
        reason: 'Coordinates must be valid finite numbers',
      };
    }

    // Sequence check: sequence number must be an integer
    if (typeof target.sequence !== 'number' || !Number.isInteger(target.sequence)) {
      return {
        isValid: false,
        code: 'STALE_SEQUENCE',
        reason: 'Sequence number must be a valid integer',
      };
    }

    // 2. Sequence order check: Stale updates must not overwrite newer ones
    if (target.sequence <= currentPosition.sequence) {
      return {
        isValid: false,
        code: 'STALE_SEQUENCE',
        reason: `Update sequence (${target.sequence}) is older or equal to current sequence (${currentPosition.sequence})`,
      };
    }

    // 3. Office boundary check
    const { minX, minY, maxX, maxY } = office.bounds;
    const radius = this.config.avatarRadius;

    if (
      target.x - radius < minX ||
      target.x + radius > maxX ||
      target.y - radius < minY ||
      target.y + radius > maxY
    ) {
      return {
        isValid: false,
        code: 'OUT_OF_BOUNDS',
        reason: `Destination (${target.x.toFixed(1)}, ${target.y.toFixed(1)}) is outside office bounds [${minX}, ${minY}, ${maxX}, ${maxY}]`,
      };
    }

    // 4. Movement velocity / distance check
    const dx = target.x - currentPosition.x;
    const dy = target.y - currentPosition.y;
    const distance = Math.hypot(dx, dy);

    const now = target.timestamp && target.timestamp > currentPosition.timestamp
      ? target.timestamp
      : Date.now();
    
    const timeDeltaSeconds = Math.max(0.016, (now - currentPosition.timestamp) / 1000);
    const speed = distance / timeDeltaSeconds;

    // Enforce reasonable movement speed: reject if teleporting unreasonably far or exceeding max speed
    if (distance > this.config.maxTeleportDistance && speed > this.config.maxSpeedPixelsPerSecond) {
      return {
        isValid: false,
        code: 'SPEED_EXCEEDED',
        reason: `Movement speed ${speed.toFixed(1)} px/s exceeded max allowed ${this.config.maxSpeedPixelsPerSecond} px/s (distance: ${distance.toFixed(1)}px)`,
      };
    }

    // 5. Collision detection with office obstacles/walls via GeometryService
    const collidingObstacle = this.geometryService.checkAvatarCollision(
      target.x,
      target.y,
      radius,
      office.obstacles
    );

    if (collidingObstacle) {
      return {
        isValid: false,
        code: 'COLLISION',
        reason: `Position collides with obstacle '${collidingObstacle.name}'`,
      };
    }

    // Determine facing direction if not explicitly supplied
    let facing = target.facing ?? currentPosition.facing ?? 'down';
    if (!target.facing && distance > 2) {
      if (Math.abs(dx) > Math.abs(dy)) {
        facing = dx > 0 ? 'right' : 'left';
      } else {
        facing = dy > 0 ? 'down' : 'up';
      }
    }

    const sanitizedPosition: AvatarPosition = {
      x: Math.round(target.x * 10) / 10,
      y: Math.round(target.y * 10) / 10,
      sequence: target.sequence,
      timestamp: now,
      facing,
    };

    return {
      isValid: true,
      sanitizedPosition,
    };
  }

  /**
   * Circle-to-AABB (axis-aligned bounding box) collision detection
   */
  private checkCollision(
    cx: number,
    cy: number,
    radius: number,
    obstacle: RectObstacle
  ): boolean {
    const closestX = Math.max(obstacle.x, Math.min(cx, obstacle.x + obstacle.width));
    const closestY = Math.max(obstacle.y, Math.min(cy, obstacle.y + obstacle.height));

    const distanceX = cx - closestX;
    const distanceY = cy - closestY;

    const distanceSquared = distanceX * distanceX + distanceY * distanceY;
    return distanceSquared < radius * radius;
  }
}
