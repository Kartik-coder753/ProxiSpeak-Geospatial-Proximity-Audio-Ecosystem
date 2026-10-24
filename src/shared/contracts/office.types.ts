export interface OfficeBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type ObstacleShapeType = 'rectangle' | 'wall' | 'polygon';

export interface BaseObstacle {
  id: string;
  name: string;
  shape?: ObstacleShapeType;
  blocksMovement?: boolean;
  blocksSound?: boolean;
  attenuation?: number; // 0 = completely blocks sound (0% transmission), 1 = fully transparent
}

export interface RectObstacle extends BaseObstacle {
  shape?: 'rectangle';
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WallObstacle extends BaseObstacle {
  shape: 'wall';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  thickness?: number;
}

export interface PolygonObstacle extends BaseObstacle {
  shape: 'polygon';
  points: Array<{ x: number; y: number }>;
}

export type Obstacle = RectObstacle | WallObstacle | PolygonObstacle;

export type OfficeAccessPolicy = 'public' | 'members_only' | 'invite_only';

export interface Office {
  id: string;
  name: string;
  description?: string;
  bounds: OfficeBounds;
  width?: number;
  height?: number;
  obstacles: Obstacle[];
  accessPolicy: OfficeAccessPolicy;
  defaultSpawnPosition: { x: number; y: number };
  layoutVersion: number;
  createdAt: Date;
  updatedAt?: Date;
}

export interface OfficeLayoutDto {
  officeId: string;
  name: string;
  width: number;
  height: number;
  bounds: OfficeBounds;
  obstacles: Obstacle[];
  layoutVersion: number;
}

export interface SoundOcclusionResult {
  isBlocked: boolean;
  totalTransmission: number; // 0 to 1 (1 = fully audible, 0 = completely muted)
  intersectingObstacles: Obstacle[];
}

export type OfficeRole = 'owner' | 'admin' | 'member' | 'guest';

export interface OfficeMembership {
  id: string;
  officeId: string;
  userId: string;
  role: OfficeRole;
  joinedAt: Date;
}
