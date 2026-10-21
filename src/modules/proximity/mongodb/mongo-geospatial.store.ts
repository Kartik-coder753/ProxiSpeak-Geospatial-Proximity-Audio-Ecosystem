import { MongoAvatarDocument } from '../../../shared/contracts/proximity.interface';

export const MONGO_AVATAR_COLLECTION = 'avatars';
export const MONGO_2D_INDEX = { position: '2d' } as const;
export const MONGO_OFFICE_2D_COMPOUND_INDEX = { officeId: 1, position: '2d' } as const;

export interface NearQueryOptions {
  $near: [number, number];
  $maxDistance?: number;
  $minDistance?: number;
}

export interface GeoWithinQueryOptions {
  $geoWithin: {
    $center: [[number, number], number]; // [[centerX, centerY], radius]
  };
}

export interface MongoAvatarQuery {
  officeId?: string;
  userId?: string | { $ne: string };
  position?: NearQueryOptions | GeoWithinQueryOptions;
  updatedAt?: { $gte?: Date; $gt?: Date };
}

/**
 * MongoDB Geospatial Collection Store
 * Provides flat 2d index modeling, $near and $geoWithin queries with Euclidean distance calculation.
 */
export class MongoGeospatialStore {
  private documents = new Map<string, MongoAvatarDocument>(); // key: userId
  private indexes = new Set<string>();

  // Spatial Grid Index for fast 2D candidate retrieval (cell size = 100 pixels)
  private readonly cellSize = 100;
  private spatialGrid = new Map<string, Set<string>>(); // "officeId:cellX:cellY" -> Set of userIds

  constructor() {
    // Default indexes as specified in Task 1
    this.createIndex({ position: '2d' });
    this.createIndex({ officeId: 1, position: '2d' });
  }

  createIndex(indexSpec: Record<string, unknown>): string {
    const name = Object.entries(indexSpec)
      .map(([k, v]) => `${k}_${v}`)
      .join('_');
    this.indexes.add(name);
    return name;
  }

  getIndexes(): string[] {
    return Array.from(this.indexes);
  }

  /**
   * Upsert an avatar position document
   */
  upsertAvatar(userId: string, officeId: string, position: [number, number], updatedAt: Date = new Date()): MongoAvatarDocument {
    const existing = this.documents.get(userId);
    if (existing) {
      this.removeFromSpatialGrid(existing);
    }

    const doc: MongoAvatarDocument = {
      _id: `doc-${userId}`,
      userId,
      officeId,
      position: [position[0], position[1]],
      updatedAt,
    };

    this.documents.set(userId, doc);
    this.addToSpatialGrid(doc);
    return doc;
  }

  deleteAvatar(userId: string): boolean {
    const doc = this.documents.get(userId);
    if (!doc) return false;

    this.removeFromSpatialGrid(doc);
    return this.documents.delete(userId);
  }

  getAvatar(userId: string): MongoAvatarDocument | null {
    return this.documents.get(userId) ?? null;
  }

  countDocuments(): number {
    return this.documents.size;
  }

  clear(): void {
    this.documents.clear();
    this.spatialGrid.clear();
  }

  /**
   * MongoDB query execution supporting $near and $geoWithin
   */
  find(query: MongoAvatarQuery): MongoAvatarDocument[] {
    const { officeId, userId, position } = query;

    let candidateDocs: MongoAvatarDocument[] = [];

    // Filter by officeId first if specified
    if (officeId && position) {
      if ('$near' in position) {
        candidateDocs = this.queryNearCandidates(officeId, position.$near, position.$maxDistance ?? Infinity);
      } else if ('$geoWithin' in position) {
        const [center, radius] = position.$geoWithin.$center;
        candidateDocs = this.queryNearCandidates(officeId, center, radius);
      } else {
        candidateDocs = this.getAllInOffice(officeId);
      }
    } else if (officeId) {
      candidateDocs = this.getAllInOffice(officeId);
    } else {
      candidateDocs = Array.from(this.documents.values());
    }

    // Filter by userId ($ne or exact)
    if (userId) {
      if (typeof userId === 'object' && '$ne' in userId) {
        const neVal = userId.$ne;
        candidateDocs = candidateDocs.filter((d) => d.userId !== neVal);
      } else if (typeof userId === 'string') {
        candidateDocs = candidateDocs.filter((d) => d.userId === userId);
      }
    }

    // Filter by updatedAt if specified
    if (query.updatedAt?.$gte) {
      const minDate = query.updatedAt.$gte;
      candidateDocs = candidateDocs.filter((d) => d.updatedAt >= minDate);
    }

    // Execute Geospatial matching & sorting
    if (position && '$near' in position) {
      const targetPoint = position.$near;
      const maxDist = position.$maxDistance ?? Infinity;
      const minDist = position.$minDistance ?? 0;

      const scored = candidateDocs
        .map((doc) => {
          const dist = this.calculateEuclideanDistance(targetPoint, doc.position);
          return { doc, dist };
        })
        .filter((item) => item.dist >= minDist && item.dist <= maxDist);

      // $near orders documents by distance ascending
      scored.sort((a, b) => a.dist - b.dist);
      return scored.map((item) => item.doc);
    }

    if (position && '$geoWithin' in position) {
      const [center, radius] = position.$geoWithin.$center;

      return candidateDocs.filter((doc) => {
        const dist = this.calculateEuclideanDistance(center, doc.position);
        return dist <= radius;
      });
    }

    return candidateDocs;
  }

  /**
   * Helper for exact Euclidean distance
   * d = sqrt((x2 - x1)^2 + (y2 - y1)^2)
   */
  calculateEuclideanDistance(p1: [number, number], p2: [number, number]): number {
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    return Math.hypot(dx, dy);
  }

  private getAllInOffice(officeId: string): MongoAvatarDocument[] {
    const result: MongoAvatarDocument[] = [];
    for (const doc of this.documents.values()) {
      if (doc.officeId === officeId) {
        result.push(doc);
      }
    }
    return result;
  }

  private getGridKey(officeId: string, cellX: number, cellY: number): string {
    return `${officeId}:${cellX}:${cellY}`;
  }

  private addToSpatialGrid(doc: MongoAvatarDocument): void {
    const cellX = Math.floor(doc.position[0] / this.cellSize);
    const cellY = Math.floor(doc.position[1] / this.cellSize);
    const key = this.getGridKey(doc.officeId, cellX, cellY);

    let cell = this.spatialGrid.get(key);
    if (!cell) {
      cell = new Set();
      this.spatialGrid.set(key, cell);
    }
    cell.add(doc.userId);
  }

  private removeFromSpatialGrid(doc: MongoAvatarDocument): void {
    const cellX = Math.floor(doc.position[0] / this.cellSize);
    const cellY = Math.floor(doc.position[1] / this.cellSize);
    const key = this.getGridKey(doc.officeId, cellX, cellY);

    const cell = this.spatialGrid.get(key);
    if (cell) {
      cell.delete(doc.userId);
      if (cell.size === 0) {
        this.spatialGrid.delete(key);
      }
    }
  }

  /**
   * Spatial grid bounding box search around target point
   */
  private queryNearCandidates(officeId: string, center: [number, number], radius: number): MongoAvatarDocument[] {
    if (radius === Infinity || radius > 500) {
      return this.getAllInOffice(officeId);
    }

    const minCellX = Math.floor((center[0] - radius) / this.cellSize);
    const maxCellX = Math.floor((center[0] + radius) / this.cellSize);
    const minCellY = Math.floor((center[1] - radius) / this.cellSize);
    const maxCellY = Math.floor((center[1] + radius) / this.cellSize);

    const candidateUserIds = new Set<string>();

    for (let cx = minCellX; cx <= maxCellX; cx++) {
      for (let cy = minCellY; cy <= maxCellY; cy++) {
        const key = this.getGridKey(officeId, cx, cy);
        const cell = this.spatialGrid.get(key);
        if (cell) {
          for (const uid of cell) {
            candidateUserIds.add(uid);
          }
        }
      }
    }

    const docs: MongoAvatarDocument[] = [];
    for (const uid of candidateUserIds) {
      const doc = this.documents.get(uid);
      if (doc && doc.officeId === officeId) {
        docs.push(doc);
      }
    }
    return docs;
  }
}
