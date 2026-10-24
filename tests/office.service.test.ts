import { describe, it, expect, beforeEach } from 'vitest';
import { OfficeService } from '../src/modules/offices/office.service';
import { createSeedRepositories } from '../src/repositories/in-memory.repositories';
import { OfficeLayoutDto } from '../src/shared/contracts/office.types';

describe('OfficeService Unit Tests (Layout Persistence & Permissions)', () => {
  let officeService: OfficeService;
  let repos: ReturnType<typeof createSeedRepositories>;
  let layoutBroadcasts: Array<{ officeId: string; layout: OfficeLayoutDto }>;

  beforeEach(() => {
    repos = createSeedRepositories();
    layoutBroadcasts = [];

    officeService = new OfficeService(
      repos.officeRepo,
      repos.membershipRepo,
      (officeId, layout) => {
        layoutBroadcasts.push({ officeId, layout });
      }
    );
  });

  it('retrieves the persisted office layout with dimensions, obstacles and layoutVersion', async () => {
    const layout = await officeService.getOfficeLayout('infotact-office');
    expect(layout).not.toBeNull();
    expect(layout?.officeId).toBe('infotact-office');
    expect(layout?.width).toBe(1200);
    expect(layout?.height).toBe(800);
    expect(layout?.layoutVersion).toBe(1);
    expect(layout?.obstacles.length).toBeGreaterThan(0);
  });

  it('allows authorized administrator (Alice) to update office layout and increments layoutVersion', async () => {
    // Alice is an admin of infotact-office
    const result = await officeService.updateOfficeLayout('user-alice', 'infotact-office', {
      name: 'Infotact Campus Renovated',
      width: 1400,
      height: 900,
      obstacles: [
        {
          id: 'new-wall-1',
          name: 'Executive Soundproof Wall',
          shape: 'wall',
          x1: 500,
          y1: 100,
          x2: 500,
          y2: 600,
          thickness: 12,
          blocksMovement: true,
          blocksSound: true,
          attenuation: 0,
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.office).toBeDefined();
    expect(result.office?.name).toBe('Infotact Campus Renovated');
    expect(result.office?.bounds.maxX).toBe(1400);
    expect(result.office?.layoutVersion).toBe(2); // Incremented from 1 to 2

    // Verify broadcast event was triggered for active clients
    expect(layoutBroadcasts).toHaveLength(1);
    expect(layoutBroadcasts[0].officeId).toBe('infotact-office');
    expect(layoutBroadcasts[0].layout.layoutVersion).toBe(2);

    // Verify persistence in repository
    const reloaded = await officeService.getOfficeLayout('infotact-office');
    expect(reloaded?.width).toBe(1400);
    expect(reloaded?.layoutVersion).toBe(2);
  });

  it('strictly rejects layout updates from ordinary participants or guests (Eve)', async () => {
    // Eve is only a guest
    const result = await officeService.updateOfficeLayout('user-eve', 'infotact-office', {
      name: 'Hacked Layout',
      obstacles: [],
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('FORBIDDEN');
    expect(result.error).toContain('Only office administrators or owners');

    // Verify layout was NOT changed
    const layout = await officeService.getOfficeLayout('infotact-office');
    expect(layout?.name).toBe('Infotact Main Campus');
  });

  it('rejects layout updates with invalid dimensions', async () => {
    const result = await officeService.updateOfficeLayout('user-alice', 'infotact-office', {
      width: -500, // Invalid negative width
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_DIMENSIONS');
  });

  it('rejects layout updates with out-of-bounds obstacle coordinates', async () => {
    const result = await officeService.updateOfficeLayout('user-alice', 'infotact-office', {
      obstacles: [
        {
          id: 'bad-wall',
          name: 'Wall outside room',
          shape: 'wall',
          x1: 1500, // Outside 1200 max width
          y1: 200,
          x2: 1600,
          y2: 300,
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_OBSTACLE');
    expect(result.error).toContain('within office bounds');
  });

  it('rejects obstacle with invalid attenuation factor (<0 or >1)', async () => {
    const result = await officeService.updateOfficeLayout('user-alice', 'infotact-office', {
      obstacles: [
        {
          id: 'bad-attenuation',
          name: 'Faulty Partition',
          shape: 'rectangle',
          x: 200,
          y: 200,
          width: 50,
          height: 50,
          attenuation: 1.5, // Invalid > 1
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_OBSTACLE');
    expect(result.error).toContain('between 0 and 1');
  });
});
