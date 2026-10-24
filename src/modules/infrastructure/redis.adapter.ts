import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';

export interface RedisAdapterConfig {
  url?: string;
  host?: string;
  port?: number;
  password?: string;
  keyPrefix?: string;
}

export interface RedisAdapterInstance {
  isEnabled: boolean;
  pubClient?: Redis;
  subClient?: Redis;
  close: () => Promise<void>;
}

/**
 * Configure the Socket.io Redis adapter using environment variables
 *
 * Multi-Instance Architecture & Load Balancer Requirements:
 * 1. Sticky Sessions: When using HTTP long-polling transport fallback, the load balancer
 *    must enforce session affinity (cookie-based sticky sessions) so all handshake requests
 *    from a client route to the same instance. Alternatively, configure client transport: ['websocket'].
 * 2. Cross-Instance Messaging: The Redis adapter forwards Socket.io room broadcasts
 *    (e.g., io.to('office:infotact').emit(...)) between Node.js instances via Redis Pub/Sub.
 * 3. State Consistency: In-memory presence maps are instance-local. Cross-instance presence
 *    synchronization operates via shared room broadcasts or a centralized backing store (e.g. MongoDB).
 * 4. Recovery: Redis Pub/Sub is at-most-once. Client reconnection requests a fresh PresenceSnapshot
 *    upon joining an office, guaranteeing state recovery without lost-event artifacts.
 */
export async function setupSocketIoRedisAdapter(
  io: Server,
  customConfig?: RedisAdapterConfig
): Promise<RedisAdapterInstance> {
  const redisUrl = customConfig?.url || process.env.REDIS_URL;
  const redisHost = customConfig?.host || process.env.REDIS_HOST;
  const redisPort = customConfig?.port || (process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : undefined);

  if (!redisUrl && !redisHost) {
    return {
      isEnabled: false,
      close: async () => {},
    };
  }

  try {
    const redisOptions = {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      retryStrategy(times: number) {
        if (times > 5) return null; // stop retrying after 5 attempts
        return Math.min(times * 100, 2000);
      },
    };

    const pubClient = redisUrl
      ? new Redis(redisUrl, redisOptions)
      : new Redis({ host: redisHost, port: redisPort ?? 6379, password: customConfig?.password, ...redisOptions });

    const subClient = pubClient.duplicate();

    pubClient.on('error', (err) => {
      console.warn('[Redis PubClient Error]:', err.message);
    });

    subClient.on('error', (err) => {
      console.warn('[Redis SubClient Error]:', err.message);
    });

    // Wait for connection ready
    await Promise.all([
      new Promise<void>((resolve, reject) => {
        pubClient.once('ready', () => resolve());
        pubClient.once('error', (err) => reject(err));
      }),
      new Promise<void>((resolve, reject) => {
        subClient.once('ready', () => resolve());
        subClient.once('error', (err) => reject(err));
      }),
    ]);

    // Attach official Socket.io Redis adapter
    io.adapter(createAdapter(pubClient, subClient));
    console.log('[Redis Adapter] Successfully attached Redis adapter to Socket.io');

    return {
      isEnabled: true,
      pubClient,
      subClient,
      close: async () => {
        try {
          await Promise.all([pubClient.quit(), subClient.quit()]);
        } catch {
          pubClient.disconnect();
          subClient.disconnect();
        }
      },
    };
  } catch (err) {
    console.warn(
      `[Redis Adapter] Redis connection failed (${(err as Error).message}). Falling back to in-memory adapter.`
    );
    return {
      isEnabled: false,
      close: async () => {},
    };
  }
}
