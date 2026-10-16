export interface OfficeBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface RectObstacle {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type OfficeAccessPolicy = 'public' | 'members_only' | 'invite_only';

export interface Office {
  id: string;
  name: string;
  description?: string;
  bounds: OfficeBounds;
  obstacles: RectObstacle[];
  accessPolicy: OfficeAccessPolicy;
  defaultSpawnPosition: { x: number; y: number };
  createdAt: Date;
}

export type OfficeRole = 'owner' | 'admin' | 'member' | 'guest';

export interface OfficeMembership {
  id: string;
  officeId: string;
  userId: string;
  role: OfficeRole;
  joinedAt: Date;
}
