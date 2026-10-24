import { describe, it, expect } from 'vitest';
import { GeometryService } from '../src/modules/offices/geometry.service';
import { Obstacle } from '../src/shared/contracts/office.types';

describe('GeometryService Unit Tests (Collision & Sound Occlusion)', () => {
  const geometryService = new GeometryService();

  const testObstacles: Obstacle[] = [
    // Solid sound-blocking concrete wall from (400, 100) to (400, 500)
    {
      id: 'wall-concrete',
      name: 'Concrete Partition Wall',
      shape: 'wall',
      x1: 400,
      y1: 100,
      x2: 400,
      y2: 500,
      thickness: 10,
      blocksMovement: true,
      blocksSound: true,
      attenuation: 0, // 0% transmission (completely blocks audio)
    },
    // Glass partition that partially dampens audio (attenuation = 0.4)
    {
      id: 'glass-wall',
      name: 'Glass Meeting Divider',
      shape: 'wall',
      x1: 700,
      y1: 100,
      x2: 700,
      y2: 400,
      thickness: 6,
      blocksMovement: true,
      blocksSound: true,
      attenuation: 0.4, // 40% transmission
    },
    // Desk cluster (blocks movement, but low height so blocksSound: false)
    {
      id: 'dev-desks',
      name: 'Developer Workstations',
      shape: 'rectangle',
      x: 100,
      y: 200,
      width: 150,
      height: 80,
      blocksMovement: true,
      blocksSound: false,
      attenuation: 1.0,
    },
    // Decorative carpet / marker (neither movement nor sound blocked)
    {
      id: 'carpet-rug',
      name: 'Lounge Rug',
      shape: 'rectangle',
      x: 100,
      y: 600,
      width: 200,
      height: 100,
      blocksMovement: false,
      blocksSound: false,
    },
  ];

  describe('Avatar Movement Collision', () => {
    it('detects collision with rectangular obstacle bounding box', () => {
      // Desk is at x: 100..250, y: 200..280. Avatar at (120, 220) with radius 12
      const collision = geometryService.checkAvatarCollision(120, 220, 12, testObstacles);
      expect(collision).not.toBeNull();
      expect(collision?.id).toBe('dev-desks');
    });

    it('detects collision with wall line segment within thickness and radius', () => {
      // Concrete wall is along x = 400, y from 100 to 500, thickness 10.
      // Point at (405, 300) with radius 12 (distance from line is 5px < 12 + 5 = 17px)
      const collision = geometryService.checkAvatarCollision(405, 300, 12, testObstacles);
      expect(collision).not.toBeNull();
      expect(collision?.id).toBe('wall-concrete');
    });

    it('allows movement when avatar is completely clear of obstacles', () => {
      // Open space at (550, 300)
      const collision = geometryService.checkAvatarCollision(550, 300, 12, testObstacles);
      expect(collision).toBeNull();
    });

    it('ignores obstacles configured with blocksMovement: false', () => {
      // Carpet is at x: 100..300, y: 600..700
      const collision = geometryService.checkAvatarCollision(150, 650, 12, testObstacles);
      expect(collision).toBeNull();
    });
  });

  describe('Acoustic Line-of-Sight & Sound Occlusion', () => {
    it('returns full 100% audio transmission when line-of-sight is unobstructed', () => {
      // Line from (500, 250) to (600, 250) has no obstacles in between
      const result = geometryService.checkSoundObstruction(
        { x: 500, y: 250 },
        { x: 600, y: 250 },
        testObstacles
      );

      expect(result.isBlocked).toBe(false);
      expect(result.totalTransmission).toBe(1.0);
      expect(result.intersectingObstacles).toHaveLength(0);
    });

    it('completely blocks sound when solid wall (attenuation = 0) intersects line of sight', () => {
      // Alice is at (350, 300), Bob is at (450, 300).
      // Line segment crosses Concrete Partition Wall at x = 400
      const result = geometryService.checkSoundObstruction(
        { x: 350, y: 300 },
        { x: 450, y: 300 },
        testObstacles
      );

      expect(result.isBlocked).toBe(true);
      expect(result.totalTransmission).toBe(0);
      expect(result.intersectingObstacles).toHaveLength(1);
      expect(result.intersectingObstacles[0].id).toBe('wall-concrete');
    });

    it('partially attenuates sound when passing through a glass partition', () => {
      // Alice at (650, 250), Bob at (750, 250).
      // Line crosses Glass Meeting Divider (attenuation = 0.4) at x = 700
      const result = geometryService.checkSoundObstruction(
        { x: 650, y: 250 },
        { x: 750, y: 250 },
        testObstacles
      );

      expect(result.isBlocked).toBe(false);
      expect(result.totalTransmission).toBe(0.4);
      expect(result.intersectingObstacles[0].id).toBe('glass-wall');
    });

    it('does not attenuate sound across low furniture with blocksSound: false', () => {
      // Line crosses dev desks from (80, 240) to (270, 240)
      const result = geometryService.checkSoundObstruction(
        { x: 80, y: 240 },
        { x: 270, y: 240 },
        testObstacles
      );

      expect(result.isBlocked).toBe(false);
      expect(result.totalTransmission).toBe(1.0);
      expect(result.intersectingObstacles).toHaveLength(0);
    });

    it('calculates cumulative attenuation across multiple semi-permeable dividers', () => {
      const dualGlassObstacles: Obstacle[] = [
        {
          id: 'glass-1',
          name: 'Glass 1',
          shape: 'wall',
          x1: 200,
          y1: 50,
          x2: 200,
          y2: 400,
          blocksSound: true,
          attenuation: 0.5,
        },
        {
          id: 'glass-2',
          name: 'Glass 2',
          shape: 'wall',
          x1: 300,
          y1: 50,
          x2: 300,
          y2: 400,
          blocksSound: true,
          attenuation: 0.5,
        },
      ];

      // Segment from (100, 200) to (400, 200) crosses both glass dividers: 0.5 * 0.5 = 0.25
      const result = geometryService.checkSoundObstruction(
        { x: 100, y: 200 },
        { x: 400, y: 200 },
        dualGlassObstacles
      );

      expect(result.isBlocked).toBe(false);
      expect(result.totalTransmission).toBe(0.25);
      expect(result.intersectingObstacles).toHaveLength(2);
    });
  });
});
