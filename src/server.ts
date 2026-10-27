import { createServer, Server as HttpServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import { createApp } from './app';
import { createSeedRepositories } from './repositories/in-memory.repositories';
import { AuthService } from './modules/auth/auth.service';
import { MovementValidator } from './modules/presence/movement.validator';
import { PresenceService } from './modules/presence/presence.service';
import { registerPresenceHandlers, TypedServer } from './modules/presence/presence.socket';
import { ProximityService } from './modules/proximity/proximity.service';
import { SignalingService } from './modules/signaling/signaling.service';
import { registerSignalingHandlers } from './modules/signaling/signaling.socket';
import { OfficeService } from './modules/offices/office.service';
import { GeometryService } from './modules/offices/geometry.service';
import { setupSocketIoRedisAdapter } from './modules/infrastructure/redis.adapter';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

export interface ServerInstance {
  httpServer: HttpServer;
  io: TypedServer;
  presenceService: PresenceService;
  proximityService: ProximityService;
  signalingService: SignalingService;
  officeService: OfficeService;
  geometryService: GeometryService;
  authService: AuthService;
  port: number;
  close: () => Promise<void>;
}

export async function createProxiSpeakServer(customPort?: number): Promise<ServerInstance> {
  const { userRepo, officeRepo, membershipRepo } = createSeedRepositories();
  const authService = new AuthService(userRepo);
  const proximityService = new ProximityService();
  const signalingService = new SignalingService();
  const geometryService = new GeometryService();
  const movementValidator = new MovementValidator(undefined, geometryService);

  const presenceService = new PresenceService(
    userRepo,
    officeRepo,
    membershipRepo,
    proximityService,
    signalingService,
    movementValidator
  );

  proximityService.setPresenceReader(presenceService);
  signalingService.setProximityService(proximityService);
  signalingService.setPresenceReader(presenceService);

  // Subscribe signaling service to peer eligibility changes from proximity service
  proximityService.subscribeToPeerChanges((event) => {
    signalingService.onPeerEligibilityChanged(event);
  });

  const httpServer = createServer();

  const io = new Server(httpServer, {
    cors: {
      origin: process.env.CLIENT_ORIGIN ? process.env.CLIENT_ORIGIN.split(',') : true,
      credentials: true,
    },
  }) as TypedServer;

  // Broadcast live proximity updates immediately to connected clients whenever calculations change
  proximityService.subscribeToProximityUpdates((result) => {
    const sockets = presenceService.getUserSockets(result.userId);
    for (const sid of sockets) {
      io.to(sid).emit('proximity:update', {
        officeId: result.officeId,
        peers: result.peers,
      });
    }
  });

  // Initialize officeService with live broadcast callback for layout updates
  const officeService = new OfficeService(officeRepo, membershipRepo, (officeId, layout) => {
    io.to(`office:${officeId}`).emit('office:layout_updated' as any, { officeId, layout });
  });

  const app = createApp({
    presenceService,
    proximityService,
    signalingService,
    officeService,
    geometryService,
    officeRepo,
    userRepo,
    authService,
  });

  httpServer.on('request', app);

  // Configure Redis adapter if environment variables are set
  const redisAdapterInstance = await setupSocketIoRedisAdapter(io);

  // Register presence, proximity and signaling handlers using injected dependencies
  registerPresenceHandlers(io, presenceService, authService);
  registerSignalingHandlers(io, signalingService, presenceService);

  // Mount Vite middlewares in dev mode so the single server hosts API, Sockets & UI
  const isDev = process.env.NODE_ENV !== 'production' && !process.env.VITEST;
  if (isDev) {
    try {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: {
          middlewareMode: true,
          hmr: process.env.DISABLE_HMR !== 'true',
        },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } catch (e) {
      console.warn('Vite middleware could not be loaded into Express:', e);
    }
  } else if (!process.env.VITEST) {
    // Production static serving
    const distPath = path.join(rootDir, 'dist');
    const expressStatic = (await import('express')).default.static;
    app.use(expressStatic(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const port = customPort ?? Number(process.env.PORT || 3000);

  const close = async () => {
    await redisAdapterInstance.close();
    return new Promise<void>((resolve) => {
      io.close(() => {
        httpServer.close(() => {
          resolve();
        });
      });
    });
  };

  return {
    httpServer,
    io,
    presenceService,
    proximityService,
    signalingService,
    officeService,
    geometryService,
    authService,
    port,
    close,
  };
}

// Auto-run if executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createProxiSpeakServer()
    .then(({ httpServer, port }) => {
      httpServer.listen(port, '0.0.0.0', () => {
        console.log(`[ProxiSpeak Foundation] Server listening on http://0.0.0.0:${port}`);
        console.log(`[ProxiSpeak Foundation] Health check: http://0.0.0.0:${port}/health`);
      });

      const handleShutdown = (signal: string) => {
        console.log(`Received ${signal}. Shutting down gracefully...`);
        httpServer.close(() => {
          console.log('HTTP & Socket.io server closed.');
          process.exit(0);
        });
      };

      process.on('SIGTERM', () => handleShutdown('SIGTERM'));
      process.on('SIGINT', () => handleShutdown('SIGINT'));
    })
    .catch((err) => {
      console.error('Fatal error starting ProxiSpeak server:', err);
      process.exit(1);
    });
}
