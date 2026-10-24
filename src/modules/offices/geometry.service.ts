import {
  Obstacle,
  PolygonObstacle,
  RectObstacle,
  SoundOcclusionResult,
  WallObstacle,
} from '../../shared/contracts/office.types';

export interface Point2D {
  x: number;
  y: number;
}

/**
 * Geometry Service (Member 4 - Persistence & Geometry Owner)
 * Provides authoritative collision detection for avatar movement
 * and line-of-sight sound occlusion calculations for spatial audio attenuation.
 */
export class GeometryService {
  /**
   * Evaluates whether an avatar's bounding circle collides with any movement-blocking obstacle
   */
  checkAvatarCollision(
    cx: number,
    cy: number,
    radius: number,
    obstacles: Obstacle[]
  ): Obstacle | null {
    for (const obstacle of obstacles) {
      if (obstacle.blocksMovement === false) continue;

      if (this.isWallObstacle(obstacle)) {
        if (this.checkCircleWallCollision(cx, cy, radius, obstacle)) {
          return obstacle;
        }
      } else if (this.isPolygonObstacle(obstacle)) {
        if (this.checkCirclePolygonCollision(cx, cy, radius, obstacle)) {
          return obstacle;
        }
      } else {
        // Rectangle obstacle (default)
        if (this.checkCircleRectCollision(cx, cy, radius, obstacle as RectObstacle)) {
          return obstacle;
        }
      }
    }

    return null;
  }

  /**
   * Evaluates acoustic line-of-sight between two avatar positions
   * and calculates cumulative sound transmission / attenuation
   */
  checkSoundObstruction(
    p1: Point2D,
    p2: Point2D,
    obstacles: Obstacle[]
  ): SoundOcclusionResult {
    const intersectingObstacles: Obstacle[] = [];
    let totalTransmission = 1.0;

    for (const obstacle of obstacles) {
      if (obstacle.blocksSound === false) continue;

      let intersects = false;

      if (this.isWallObstacle(obstacle)) {
        intersects = this.segmentIntersectsSegment(
          p1,
          p2,
          { x: obstacle.x1, y: obstacle.y1 },
          { x: obstacle.x2, y: obstacle.y2 }
        );
      } else if (this.isPolygonObstacle(obstacle)) {
        intersects = this.segmentIntersectsPolygon(p1, p2, obstacle.points);
      } else {
        // Rectangle obstacle
        intersects = this.segmentIntersectsRect(p1, p2, obstacle as RectObstacle);
      }

      if (intersects) {
        intersectingObstacles.push(obstacle);
        const attenuation = obstacle.attenuation !== undefined ? obstacle.attenuation : 0;
        totalTransmission *= attenuation;
      }
    }

    return {
      isBlocked: intersectingObstacles.length > 0 && totalTransmission === 0,
      totalTransmission: Math.max(0, Math.min(1, Math.round(totalTransmission * 1000) / 1000)),
      intersectingObstacles,
    };
  }

  // --- Collision Primitives ---

  private checkCircleRectCollision(
    cx: number,
    cy: number,
    radius: number,
    rect: RectObstacle
  ): boolean {
    const closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.width));
    const closestY = Math.max(rect.y, Math.min(cy, rect.y + rect.height));

    const dx = cx - closestX;
    const dy = cy - closestY;

    return dx * dx + dy * dy < radius * radius;
  }

  private checkCircleWallCollision(
    cx: number,
    cy: number,
    radius: number,
    wall: WallObstacle
  ): boolean {
    const thickness = wall.thickness ?? 8;
    const effectiveRadius = radius + thickness / 2;
    const distSq = this.pointToSegmentDistanceSquared(
      cx,
      cy,
      wall.x1,
      wall.y1,
      wall.x2,
      wall.y2
    );
    return distSq < effectiveRadius * effectiveRadius;
  }

  private checkCirclePolygonCollision(
    cx: number,
    cy: number,
    radius: number,
    poly: PolygonObstacle
  ): boolean {
    const pts = poly.points;
    if (pts.length < 3) return false;

    // 1. Check if center is inside polygon
    if (this.pointInPolygon({ x: cx, y: cy }, pts)) return true;

    // 2. Check distance from center to each edge
    for (let i = 0; i < pts.length; i++) {
      const pA = pts[i];
      const pB = pts[(i + 1) % pts.length];
      const distSq = this.pointToSegmentDistanceSquared(cx, cy, pA.x, pA.y, pB.x, pB.y);
      if (distSq < radius * radius) return true;
    }

    return false;
  }

  // --- Line of Sight Intersections ---

  /**
   * Check if line segment P1-P2 intersects an axis-aligned rectangle
   */
  segmentIntersectsRect(p1: Point2D, p2: Point2D, rect: RectObstacle): boolean {
    // 1. If either endpoint is inside the rectangle
    if (this.pointInRect(p1, rect) || this.pointInRect(p2, rect)) {
      return true;
    }

    const topLeft: Point2D = { x: rect.x, y: rect.y };
    const topRight: Point2D = { x: rect.x + rect.width, y: rect.y };
    const bottomLeft: Point2D = { x: rect.x, y: rect.y + rect.height };
    const bottomRight: Point2D = { x: rect.x + rect.width, y: rect.y + rect.height };

    // 2. Check against all 4 edges of the rectangle
    return (
      this.segmentIntersectsSegment(p1, p2, topLeft, topRight) ||
      this.segmentIntersectsSegment(p1, p2, topRight, bottomRight) ||
      this.segmentIntersectsSegment(p1, p2, bottomRight, bottomLeft) ||
      this.segmentIntersectsSegment(p1, p2, bottomLeft, topLeft)
    );
  }

  /**
   * Check if segment P1-P2 intersects a polygon
   */
  segmentIntersectsPolygon(p1: Point2D, p2: Point2D, points: Point2D[]): boolean {
    if (points.length < 3) return false;

    if (this.pointInPolygon(p1, points) || this.pointInPolygon(p2, points)) {
      return true;
    }

    for (let i = 0; i < points.length; i++) {
      const pA = points[i];
      const pB = points[(i + 1) % points.length];
      if (this.segmentIntersectsSegment(p1, p2, pA, pB)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Line segment to line segment 2D intersection using 2D cross product orientation tests
   */
  segmentIntersectsSegment(p1: Point2D, q1: Point2D, p2: Point2D, q2: Point2D): boolean {
    const o1 = this.orientation(p1, q1, p2);
    const o2 = this.orientation(p1, q1, q2);
    const o3 = this.orientation(p2, q2, p1);
    const o4 = this.orientation(p2, q2, q1);

    // General case
    if (o1 !== o2 && o3 !== o4) {
      return true;
    }

    // Special Collinear Cases
    if (o1 === 0 && this.onSegment(p1, p2, q1)) return true;
    if (o2 === 0 && this.onSegment(p1, q2, q1)) return true;
    if (o3 === 0 && this.onSegment(p2, p1, q2)) return true;
    if (o4 === 0 && this.onSegment(p2, q1, q2)) return true;

    return false;
  }

  private orientation(p: Point2D, q: Point2D, r: Point2D): number {
    const val = (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
    if (Math.abs(val) < 1e-9) return 0; // collinear
    return val > 0 ? 1 : 2; // clock or counterclock wise
  }

  private onSegment(p: Point2D, q: Point2D, r: Point2D): boolean {
    return (
      q.x <= Math.max(p.x, r.x) &&
      q.x >= Math.min(p.x, r.x) &&
      q.y <= Math.max(p.y, r.y) &&
      q.y >= Math.min(p.y, r.y)
    );
  }

  private pointInRect(p: Point2D, rect: RectObstacle): boolean {
    return (
      p.x >= rect.x &&
      p.x <= rect.x + rect.width &&
      p.y >= rect.y &&
      p.y <= rect.y + rect.height
    );
  }

  private pointInPolygon(p: Point2D, points: Point2D[]): boolean {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const xi = points[i].x;
      const yi = points[i].y;
      const xj = points[j].x;
      const yj = points[j].y;

      const intersect =
        yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  private pointToSegmentDistanceSquared(
    px: number,
    py: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;

    if (lenSq === 0) {
      const ddx = px - x1;
      const ddy = py - y1;
      return ddx * ddx + ddy * ddy;
    }

    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));

    const projX = x1 + t * dx;
    const projY = y1 + t * dy;

    const ddx = px - projX;
    const ddy = py - projY;
    return ddx * ddx + ddy * ddy;
  }

  private isWallObstacle(obs: Obstacle): obs is WallObstacle {
    return obs.shape === 'wall' || ('x1' in obs && 'y1' in obs);
  }

  private isPolygonObstacle(obs: Obstacle): obs is PolygonObstacle {
    return obs.shape === 'polygon' || 'points' in obs;
  }
}
