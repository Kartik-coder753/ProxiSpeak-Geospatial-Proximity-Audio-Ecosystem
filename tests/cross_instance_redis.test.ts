import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, Server as HttpServer } from 'node:http';
import { Server as SocketIoServer } from 'socket.io';
import { io as ClientSocket, Socket as ClientSocketType } from 'socket.io-client';
import { EventEmitter } from 'node:events';

/**
 * Simulates a shared Redis Pub/Sub cluster bus connecting two independent Node.js instances
 */
class MockRedisClusterBus extends EventEmitter {
  publish(channel: string, message: string): void {
    // Deliver message to other instances on the simulated Redis channel
    this.emit('message', channel, message);
  }
}

describe('Multi-Instance Cross-Server Event Delivery (Person 4)', () => {
  let serverA: HttpServer;
  let serverB: HttpServer;
  let ioA: SocketIoServer;
  let ioB: SocketIoServer;
  const portA = 49301;
  const portB = 49302;

  const sharedRedisBus = new MockRedisClusterBus();

  beforeAll(async () => {
    // Server Instance A
    serverA = createServer();
    ioA = new SocketIoServer(serverA, { cors: { origin: '*' } });

    // Server Instance B
    serverB = createServer();
    ioB = new SocketIoServer(serverB, { cors: { origin: '*' } });

    // Cross-instance Pub/Sub bridge simulating Socket.io Redis adapter behavior
    sharedRedisBus.on('message', (_channel: string, raw: string) => {
      try {
        const { room, event, data, originInstance } = JSON.parse(raw);
        if (originInstance === 'instance-A') {
          ioB.to(room).emit(event, data);
        } else if (originInstance === 'instance-B') {
          ioA.to(room).emit(event, data);
        }
      } catch {
        // ignore malformed
      }
    });

    // Attach room relay on Instance A
    ioA.of('/').adapter.on('join-room', () => {});
    ioA.on('connection', (socket) => {
      socket.on('join', (room: string) => socket.join(room));
      socket.on('broadcast-to-room', ({ room, event, data }) => {
        // Emit locally to Instance A room members
        socket.to(room).emit(event, data);
        // Publish to shared Redis bus for cross-instance delivery to Instance B
        sharedRedisBus.publish(
          'socket.io#/#',
          JSON.stringify({ room, event, data, originInstance: 'instance-A' })
        );
      });
    });

    // Attach room relay on Instance B
    ioB.on('connection', (socket) => {
      socket.on('join', (room: string) => socket.join(room));
      socket.on('broadcast-to-room', ({ room, event, data }) => {
        socket.to(room).emit(event, data);
        sharedRedisBus.publish(
          'socket.io#/#',
          JSON.stringify({ room, event, data, originInstance: 'instance-B' })
        );
      });
    });

    await Promise.all([
      new Promise<void>((res) => serverA.listen(portA, res)),
      new Promise<void>((res) => serverB.listen(portB, res)),
    ]);
  });

  afterAll(async () => {
    await Promise.all([
      new Promise<void>((res) => ioA.close(() => serverA.close(() => res()))),
      new Promise<void>((res) => ioB.close(() => serverB.close(() => res()))),
    ]);
  });

  it('delivers room broadcasts across separate backend instances connected via simulated Redis Pub/Sub', async () => {
    // Client Alice connects to Backend Instance A
    const aliceOnA: ClientSocketType = ClientSocket(`http://127.0.0.1:${portA}`, {
      transports: ['websocket'],
    });

    // Client Bob connects to Backend Instance B
    const bobOnB: ClientSocketType = ClientSocket(`http://127.0.0.1:${portB}`, {
      transports: ['websocket'],
    });

    await Promise.all([
      new Promise<void>((res) => aliceOnA.on('connect', res)),
      new Promise<void>((res) => bobOnB.on('connect', res)),
    ]);

    // Both join the same virtual office room
    aliceOnA.emit('join', 'office:infotact-office');
    bobOnB.emit('join', 'office:infotact-office');

    // Wait for room subscription to settle
    await new Promise((r) => setTimeout(r, 60));

    // Bob on Instance B listens for cross-instance avatar:moved event
    const crossInstanceEventPromise = new Promise<{ userId: string; position: { x: number; y: number } }>(
      (resolve) => {
        bobOnB.on('avatar:moved', resolve);
      }
    );

    // Alice on Instance A emits avatar:moved to 'office:infotact-office'
    aliceOnA.emit('broadcast-to-room', {
      room: 'office:infotact-office',
      event: 'avatar:moved',
      data: {
        userId: 'alice',
        position: { x: 280, y: 310 },
      },
    });

    const receivedEvent = await crossInstanceEventPromise;

    // Verify Bob on Instance B received the event sent by Alice on Instance A!
    expect(receivedEvent.userId).toBe('alice');
    expect(receivedEvent.position.x).toBe(280);
    expect(receivedEvent.position.y).toBe(310);

    aliceOnA.disconnect();
    bobOnB.disconnect();
  });
});
