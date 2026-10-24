import {
  IOfficeRepository,
  IMembershipRepository,
} from '../../shared/contracts/repository.interfaces';
import {
  Office,
  OfficeLayoutDto,
  Obstacle,
  WallObstacle,
  PolygonObstacle,
  RectObstacle,
} from '../../shared/contracts/office.types';

export interface UpdateLayoutRequest {
  name?: string;
  width?: number;
  height?: number;
  obstacles?: Obstacle[];
}

export interface UpdateLayoutResult {
  success: boolean;
  office?: Office;
  error?: string;
  code?: 'OFFICE_NOT_FOUND' | 'FORBIDDEN' | 'INVALID_DIMENSIONS' | 'INVALID_OBSTACLE' | 'INTERNAL_ERROR';
}

/**
 * Office Service (Member 4 - Persistence Owner)
 * Manages persisted office layouts, dimensions, obstacles, and permission checks.
 */
export class OfficeService {
  constructor(
    private readonly officeRepo: IOfficeRepository,
    private readonly membershipRepo: IMembershipRepository,
    private readonly onLayoutUpdated?: (officeId: string, layout: OfficeLayoutDto) => void
  ) {}

  /**
   * Retrieve the persisted layout of an office
   */
  async getOfficeLayout(officeId: string): Promise<OfficeLayoutDto | null> {
    const office = await this.officeRepo.findById(officeId);
    if (!office) return null;

    const width = office.width ?? office.bounds.maxX - office.bounds.minX;
    const height = office.height ?? office.bounds.maxY - office.bounds.minY;

    return {
      officeId: office.id,
      name: office.name,
      width,
      height,
      bounds: office.bounds,
      obstacles: office.obstacles,
      layoutVersion: office.layoutVersion ?? 1,
    };
  }

  /**
   * Update office layout with strict administrator permission checks and geometry validation
   */
  async updateOfficeLayout(
    userId: string,
    officeId: string,
    update: UpdateLayoutRequest
  ): Promise<UpdateLayoutResult> {
    // 1. Verify office existence
    const office = await this.officeRepo.findById(officeId);
    if (!office) {
      return {
        success: false,
        code: 'OFFICE_NOT_FOUND',
        error: `Office '${officeId}' not found`,
      };
    }

    // 2. Strict permission enforcement: Only owner or admin can update layout
    const membership = await this.membershipRepo.findMembership(userId, officeId);
    const isAuthorized = membership && (membership.role === 'owner' || membership.role === 'admin');

    if (!isAuthorized) {
      return {
        success: false,
        code: 'FORBIDDEN',
        error: 'Forbidden: Only office administrators or owners can modify office layout',
      };
    }

    // 3. Validate dimensions if provided
    let newWidth = office.width ?? (office.bounds.maxX - office.bounds.minX);
    let newHeight = office.height ?? (office.bounds.maxY - office.bounds.minY);

    if (update.width !== undefined) {
      if (!Number.isFinite(update.width) || update.width <= 0 || update.width > 10000) {
        return {
          success: false,
          code: 'INVALID_DIMENSIONS',
          error: 'Width must be a finite positive number up to 10,000 pixels',
        };
      }
      newWidth = update.width;
    }

    if (update.height !== undefined) {
      if (!Number.isFinite(update.height) || update.height <= 0 || update.height > 10000) {
        return {
          success: false,
          code: 'INVALID_DIMENSIONS',
          error: 'Height must be a finite positive number up to 10,000 pixels',
        };
      }
      newHeight = update.height;
    }

    // 4. Validate obstacles if provided
    if (update.obstacles) {
      for (let i = 0; i < update.obstacles.length; i++) {
        const obs = update.obstacles[i];
        const validation = this.validateObstacle(obs, newWidth, newHeight);
        if (!validation.isValid) {
          return {
            success: false,
            code: 'INVALID_OBSTACLE',
            error: `Obstacle at index ${i} (${obs.name || obs.id}): ${validation.error}`,
          };
        }
      }
    }

    // 5. Persist update
    const updatedOffice = await this.officeRepo.updateLayout(officeId, {
      name: update.name,
      width: newWidth,
      height: newHeight,
      bounds: { minX: 0, minY: 0, maxX: newWidth, maxY: newHeight },
      obstacles: update.obstacles ?? office.obstacles,
    });

    if (!updatedOffice) {
      return {
        success: false,
        code: 'INTERNAL_ERROR',
        error: 'Failed to persist layout update in repository',
      };
    }

    const layoutDto: OfficeLayoutDto = {
      officeId: updatedOffice.id,
      name: updatedOffice.name,
      width: newWidth,
      height: newHeight,
      bounds: updatedOffice.bounds,
      obstacles: updatedOffice.obstacles,
      layoutVersion: updatedOffice.layoutVersion,
    };

    // 6. Notify listeners / broadcast to active office members
    if (this.onLayoutUpdated) {
      try {
        this.onLayoutUpdated(officeId, layoutDto);
      } catch (err) {
        console.error('Error invoking onLayoutUpdated callback:', err);
      }
    }

    return {
      success: true,
      office: updatedOffice,
    };
  }

  private validateObstacle(
    obs: Obstacle,
    officeWidth: number,
    officeHeight: number
  ): { isValid: boolean; error?: string } {
    if (!obs.id || typeof obs.id !== 'string') {
      return { isValid: false, error: 'Obstacle must have a valid ID' };
    }

    if (obs.attenuation !== undefined) {
      if (
        !Number.isFinite(obs.attenuation) ||
        obs.attenuation < 0 ||
        obs.attenuation > 1
      ) {
        return { isValid: false, error: 'Attenuation must be a number between 0 and 1' };
      }
    }

    if (obs.shape === 'wall' || ('x1' in obs && 'y1' in obs)) {
      const w = obs as WallObstacle;
      if (
        !Number.isFinite(w.x1) ||
        !Number.isFinite(w.y1) ||
        !Number.isFinite(w.x2) ||
        !Number.isFinite(w.y2)
      ) {
        return { isValid: false, error: 'Wall coordinates (x1, y1, x2, y2) must be finite numbers' };
      }
      if (w.x1 < 0 || w.x1 > officeWidth || w.x2 < 0 || w.x2 > officeWidth ||
          w.y1 < 0 || w.y1 > officeHeight || w.y2 < 0 || w.y2 > officeHeight) {
        return { isValid: false, error: 'Wall coordinates must be within office bounds' };
      }
    } else if (obs.shape === 'polygon' || 'points' in obs) {
      const p = obs as PolygonObstacle;
      if (!Array.isArray(p.points) || p.points.length < 3) {
        return { isValid: false, error: 'Polygon must have at least 3 points' };
      }
      for (const pt of p.points) {
        if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) {
          return { isValid: false, error: 'Polygon point coordinates must be finite' };
        }
      }
    } else {
      // Rectangle
      const r = obs as RectObstacle;
      if (
        !Number.isFinite(r.x) ||
        !Number.isFinite(r.y) ||
        !Number.isFinite(r.width) ||
        !Number.isFinite(r.height) ||
        r.width <= 0 ||
        r.height <= 0
      ) {
        return { isValid: false, error: 'Rectangle x, y, width, and height must be positive numbers' };
      }
      if (r.x < 0 || r.y < 0 || r.x + r.width > officeWidth || r.y + r.height > officeHeight) {
        return { isValid: false, error: 'Rectangle geometry must fit inside office bounds' };
      }
    }

    return { isValid: true };
  }
}
