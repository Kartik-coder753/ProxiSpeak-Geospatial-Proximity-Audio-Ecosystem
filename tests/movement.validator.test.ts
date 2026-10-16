import { describe, it, expect } from 'vitest';
import { MovementValidator } from '../src/modules/presence/movement.validator';
import { Office } from '../src/shared/contracts/office.types';
import { AvatarPosition } from '../src/shared/contracts/presence.types';

describe('MovementValidator Unit Tests', () => {
  const validator = new MovementValidator();

  const mockOffice: Office = {
    id: 'test-office',
    name: 'Test Office',
    bounds: { minX: 0, minY: 0, maxX: 1200, maxY: 800 },
    accessPolicy: 'members_only',
    defaultSpawnPosition: { x: 100, y: 100 },
    obstacles: [
      {
        id: 'wall-1',
        name: 'Conference Room Partition',
        x: 500,
        y: 200,
        width: 40,
        height: 300,
      },
    ],
    createdAt: new Date(),
  };

  const initialPosition: AvatarPosition = {
    x: 100,
    y: 100,
    sequence: 5,
    timestamp: 1000000,
    facing: 'down',
  };

  it('accepts valid progressive movement within bounds', () => {
    const result = validator.validateMovement(
      initialPosition,
      {
        x: 120,
        y: 110,
        sequence: 6,
        timestamp: 1000100,
      },
      mockOffice
    );

    expect(result.isValid).toBe(true);
    expect(result.sanitizedPosition).toBeDefined();
    expect(result.sanitizedPosition?.x).toBe(120);
    expect(result.sanitizedPosition?.y).toBe(110);
    expect(result.sanitizedPosition?.sequence).toBe(6);
  });

  it('rejects invalid or non-finite coordinates (NaN, Infinity)', () => {
    const nanResult = validator.validateMovement(
      initialPosition,
      { x: NaN, y: 100, sequence: 6 },
      mockOffice
    );
    expect(nanResult.isValid).toBe(false);
    expect(nanResult.code).toBe('INVALID_COORDINATES');

    const infResult = validator.validateMovement(
      initialPosition,
      { x: 100, y: Infinity, sequence: 6 },
      mockOffice
    );
    expect(infResult.isValid).toBe(false);
    expect(infResult.code).toBe('INVALID_COORDINATES');
  });

  it('rejects coordinates outside office boundaries', () => {
    // Office bounds are maxX: 1200, maxY: 800
    const outResult = validator.validateMovement(
      initialPosition,
      { x: 1300, y: 400, sequence: 6 },
      mockOffice
    );
    expect(outResult.isValid).toBe(false);
    expect(outResult.code).toBe('OUT_OF_BOUNDS');

    const negativeResult = validator.validateMovement(
      initialPosition,
      { x: -10, y: 100, sequence: 6 },
      mockOffice
    );
    expect(negativeResult.isValid).toBe(false);
    expect(negativeResult.code).toBe('OUT_OF_BOUNDS');
  });

  it('rejects stale or out-of-order sequence numbers', () => {
    // Current sequence is 5. Sequence 4 or 5 must be rejected
    const staleResult = validator.validateMovement(
      initialPosition,
      { x: 110, y: 100, sequence: 4 },
      mockOffice
    );
    expect(staleResult.isValid).toBe(false);
    expect(staleResult.code).toBe('STALE_SEQUENCE');

    const duplicateResult = validator.validateMovement(
      initialPosition,
      { x: 110, y: 100, sequence: 5 },
      mockOffice
    );
    expect(duplicateResult.isValid).toBe(false);
    expect(duplicateResult.code).toBe('STALE_SEQUENCE');
  });

  it('rejects excessive movement speed or teleportation', () => {
    // Attempting to move 600px in 50ms (velocity 12,000 px/s)
    const teleportResult = validator.validateMovement(
      initialPosition,
      {
        x: 800,
        y: 700,
        sequence: 6,
        timestamp: initialPosition.timestamp + 50,
      },
      mockOffice
    );
    expect(teleportResult.isValid).toBe(false);
    expect(teleportResult.code).toBe('SPEED_EXCEEDED');
  });

  it('rejects target positions colliding with obstacles or walls', () => {
    // Obstacle is at x: 500, y: 200, width: 40, height: 300
    const collisionPos: AvatarPosition = {
      x: 480,
      y: 250,
      sequence: 10,
      timestamp: 2000000,
    };

    // Moving into center of wall
    const result = validator.validateMovement(
      collisionPos,
      {
        x: 510,
        y: 250,
        sequence: 11,
        timestamp: 2000100,
      },
      mockOffice
    );

    expect(result.isValid).toBe(false);
    expect(result.code).toBe('COLLISION');
    expect(result.reason).toContain('Conference Room Partition');
  });
});
