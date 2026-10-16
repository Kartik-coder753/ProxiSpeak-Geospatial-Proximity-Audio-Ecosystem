import { describe, it, expect, beforeEach } from 'vitest';
import { PresenceService } from '../src/modules/presence/presence.service';
import { createSeedRepositories } from '../src/repositories/in-memory.repositories';
import { ProximityService } from '../src/modules/proximity/proximity.service';
import { SignalingService } from '../src/modules/signaling/signaling.service';
import { MovementValidator } from '../src/modules/presence/movement.validator';

describe('PresenceService Unit Tests', () => {
  let presenceService: PresenceService;
  let proximityService: ProximityService;
  let signalingService: SignalingService;
  let repos: ReturnType<typeof createSeedRepositories>;

  beforeEach(() => {
    repos = createSeedRepositories();
    proximityService = new ProximityService();
    signalingService = new SignalingService();
    const validator = new MovementValidator();

    presenceService = new PresenceService(
      repos.userRepo,
      repos.officeRepo,
      repos.membershipRepo,
      proximityService,
      signalingService,
      validator
    );
  });

  it('permits authorized members and rejects unauthorized users from restricted offices', async () => {
    // Alice is a member of executive-boardroom
    const aliceCheck = await presenceService.canUserEnterOffice('user-alice', 'executive-boardroom');
    expect(aliceCheck.allowed).toBe(true);

    // Eve is NOT a member of executive-boardroom
    const eveCheck = await presenceService.canUserEnterOffice('user-eve', 'executive-boardroom');
    expect(eveCheck.allowed).toBe(false);
    expect(eveCheck.code).toBe('FORBIDDEN');

    // Both can enter public offices
    const evePublicCheck = await presenceService.canUserEnterOffice('user-eve', 'public-townhall');
    expect(evePublicCheck.allowed).toBe(true);
  });

  it('registers connections and answers online presence queries', async () => {
    const alice = (await repos.userRepo.findById('user-alice'))!;
    presenceService.registerSocketConnection('socket-alice-1', alice);

    expect(presenceService.getOnlineUsers()).toContain('user-alice');
    expect(presenceService.getUserSockets('user-alice')).toEqual(['socket-alice-1']);
  });

  it('allows joining an office and registers initial position', async () => {
    const alice = (await repos.userRepo.findById('user-alice'))!;
    presenceService.registerSocketConnection('socket-alice-1', alice);

    const joinResult = await presenceService.joinOffice(
      'socket-alice-1',
      alice,
      'infotact-office',
      { x: 250, y: 250 }
    );

    expect(joinResult.success).toBe(true);
    expect(joinResult.member).toBeDefined();
    expect(joinResult.member?.position.x).toBe(250);
    expect(joinResult.member?.position.y).toBe(250);

    // Verify snapshot
    const snapshot = presenceService.getOfficeSnapshot('infotact-office');
    expect(snapshot.members.length).toBe(1);
    expect(snapshot.members[0].userId).toBe('user-alice');

    // Verify proximity service was notified via DI
    const lastEvent = proximityService.getPresenceEvents()[0];
    expect(lastEvent.userId).toBe('user-alice');
    expect(lastEvent.type).toBe('joined');
  });

  it('handles multi-tab connections without duplicate avatars and only disconnects on last socket closure', async () => {
    const alice = (await repos.userRepo.findById('user-alice'))!;
    
    // Tab 1 connects
    presenceService.registerSocketConnection('socket-alice-tab1', alice);
    await presenceService.joinOffice('socket-alice-tab1', alice, 'infotact-office');

    // Tab 2 connects (same user, new tab)
    presenceService.registerSocketConnection('socket-alice-tab2', alice);
    await presenceService.joinOffice('socket-alice-tab2', alice, 'infotact-office');

    expect(presenceService.getUserSockets('user-alice')).toHaveLength(2);

    // Snapshot should still only show Alice ONCE
    const snapshot = presenceService.getOfficeSnapshot('infotact-office');
    expect(snapshot.members.filter((m) => m.userId === 'user-alice')).toHaveLength(1);

    // Close Tab 1 - Alice is still active via Tab 2
    const dcTab1 = await presenceService.handleDisconnect('socket-alice-tab1');
    expect(dcTab1?.isLastSocketInOffice).toBe(false);
    expect(presenceService.getUserPosition('user-alice')).not.toBeNull();

    // Close Tab 2 - Now Alice is fully disconnected
    const dcTab2 = await presenceService.handleDisconnect('socket-alice-tab2');
    expect(dcTab2?.isLastSocketInOffice).toBe(true);
    expect(presenceService.getUserPosition('user-alice')).toBeNull();

    // Verify signaling service was notified for WebRTC cleanup
    const sigEvents = signalingService.getDisconnectedEvents();
    expect(sigEvents.some((e) => e.userId === 'user-alice')).toBe(true);
  });
});
