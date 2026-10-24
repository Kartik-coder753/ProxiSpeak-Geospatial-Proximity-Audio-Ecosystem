import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import { PresenceService } from './modules/presence/presence.service';
import { ProximityService } from './modules/proximity/proximity.service';
import { SignalingService } from './modules/signaling/signaling.service';
import { OfficeService } from './modules/offices/office.service';
import { GeometryService } from './modules/offices/geometry.service';
import { IOfficeRepository, IUserRepository } from './shared/contracts/repository.interfaces';
import { IAuthService } from './shared/contracts/user.types';

export interface AppDependencies {
  presenceService?: PresenceService;
  proximityService?: ProximityService;
  signalingService?: SignalingService;
  officeService?: OfficeService;
  geometryService?: GeometryService;
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

  // Office Layout Retrieval (Person 4)
  app.get('/api/offices/:officeId/layout', async (req: Request, res: Response) => {
    try {
      if (!deps?.officeService) {
        return res.status(404).json({ error: 'Office service not initialized' });
      }
      const layout = await deps.officeService.getOfficeLayout(req.params.officeId);
      if (!layout) {
        return res.status(404).json({ error: `Office '${req.params.officeId}' not found` });
      }
      res.json(layout);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Office Layout Update (Protected - Admin/Owner Only) (Person 4)
  app.put('/api/offices/:officeId/layout', async (req: Request, res: Response) => {
    try {
      if (!deps?.officeService || !deps?.authService) {
        return res.status(500).json({ error: 'Services not initialized' });
      }

      const authHeader = req.headers.authorization || (req.headers['x-auth-token'] as string);
      if (!authHeader) {
        return res.status(401).json({ error: 'Unauthorized: missing authentication token', code: 'UNAUTHORIZED' });
      }

      const user = await deps.authService.verifyToken(authHeader);
      if (!user) {
        return res.status(401).json({ error: 'Unauthorized: invalid or expired token', code: 'UNAUTHORIZED' });
      }

      const result = await deps.officeService.updateOfficeLayout(user.id, req.params.officeId, req.body);
      if (!result.success) {
        if (result.code === 'FORBIDDEN') {
          return res.status(403).json({ error: result.error, code: result.code });
        }
        if (result.code === 'OFFICE_NOT_FOUND') {
          return res.status(404).json({ error: result.error, code: result.code });
        }
        return res.status(400).json({ error: result.error, code: result.code });
      }

      res.status(200).json({ success: true, layout: result.office });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Acoustic Line of Sight / Sound Occlusion Test Endpoint
  app.post('/api/offices/:officeId/occlusion', async (req: Request, res: Response) => {
    try {
      if (!deps?.officeRepo || !deps?.geometryService) {
        return res.status(500).json({ error: 'Services not initialized' });
      }
      const office = await deps.officeRepo.findById(req.params.officeId);
      if (!office) return res.status(404).json({ error: 'Office not found' });

      const { p1, p2 } = req.body;
      if (!p1 || !p2) {
        return res.status(400).json({ error: 'Both p1 {x,y} and p2 {x,y} are required' });
      }

      const occlusion = deps.geometryService.checkSoundObstruction(p1, p2, office.obstacles);
      res.json({
        officeId: office.id,
        p1,
        p2,
        ...occlusion,
      });
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
