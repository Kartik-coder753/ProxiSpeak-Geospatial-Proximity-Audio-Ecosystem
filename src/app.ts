import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import { PresenceService } from './modules/presence/presence.service';
import { ProximityService } from './modules/proximity/proximity.service';
import { SignalingService } from './modules/signaling/signaling.service';
import { IOfficeRepository, IUserRepository } from './shared/contracts/repository.interfaces';
import { IAuthService } from './shared/contracts/user.types';

export interface AppDependencies {
  presenceService?: PresenceService;
  proximityService?: ProximityService;
  signalingService?: SignalingService;
  officeRepo?: IOfficeRepository;
  userRepo?: IUserRepository;
  authService?: IAuthService;
}

export function createApp(deps?: AppDependencies): Express {
  const app = express();

  app.use(express.json());

  const clientOrigin = process.env.CLIENT_ORIGIN;
  app.use(
    cors({
      origin: clientOrigin ? clientOrigin.split(',') : true,
      credentials: true,
    })
  );

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      service: 'ProxiSpeak Foundation',
      version: '1.0.0',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  // REST endpoints for inspection, diagnostics and UI client
  app.get('/api/offices', async (_req: Request, res: Response) => {
    try {
      if (!deps?.officeRepo) {
        return res.status(200).json([]);
      }
      const offices = await deps.officeRepo.listOffices();
      res.json(offices);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/presence/state', (_req: Request, res: Response) => {
    if (!deps?.presenceService) {
      return res.status(200).json({ onlineUsers: [], offices: {} });
    }

    const onlineUsers = deps.presenceService.getOnlineUsers();
    const presences = deps.presenceService.getAllOfficePresences();

    res.json({
      onlineUsersCount: onlineUsers.length,
      onlineUsers,
      presences,
      timestamp: Date.now(),
    });
  });

  app.get('/api/proximity/peers/:userId', (req: Request, res: Response) => {
    if (!deps?.proximityService) {
      return res.status(200).json({ peers: [] });
    }
    const peers = deps.proximityService.getPeersForUser(req.params.userId);
    res.json({
      userId: req.params.userId,
      peers,
      config: deps.proximityService.getConfig(),
      timestamp: Date.now(),
    });
  });

  app.get('/api/proximity/config', (_req: Request, res: Response) => {
    if (!deps?.proximityService) {
      return res.status(200).json({});
    }
    res.json(deps.proximityService.getConfig());
  });

  app.get('/api/auth/demo-users', async (_req: Request, res: Response) => {
    if (!deps?.userRepo || !deps?.authService) {
      return res.status(200).json([]);
    }

    const users = await deps.userRepo.listUsers();
    const demoAccounts = users.map((u) => ({
      user: u,
      token: deps.authService!.generateToken(u),
      simpleToken: `token-${u.username}`,
    }));

    res.json(demoAccounts);
  });

  return app;
}
