import type { FastifyPluginAsync } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';

// Tophbase provides a no-op WebSocket endpoint at /realtime/v1/websocket.
// The Supabase JS client opens this connection immediately on createClient(),
// even if the app never uses realtime subscriptions. Without this handler,
// every createClient() call would log a connection error and emit CHANNEL_ERROR.
//
// This handler accepts the upgrade, responds to Phoenix heartbeats, and
// silently absorbs all other messages. It never pushes events to clients.

const HEARTBEAT_REPLY = JSON.stringify({
  event: 'phx_reply',
  ref: null,
  topic: 'phoenix',
  payload: { status: 'ok', response: {} },
});

const JOIN_REPLY = (ref: string | null, topic: string) =>
  JSON.stringify({
    event: 'phx_reply',
    ref,
    topic,
    payload: { status: 'ok', response: {} },
  });

const realtimePlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(fastifyWebsocket);

  fastify.get('/realtime/v1/websocket', { websocket: true }, (socket, _request) => {
    socket.on('message', (raw: Buffer | string) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          event?: string;
          ref?: string | null;
          topic?: string;
        };

        if (msg.event === 'heartbeat') {
          socket.send(HEARTBEAT_REPLY);
          return;
        }

        // phx_join and other channel messages — acknowledge them
        if (msg.event && msg.ref !== undefined) {
          socket.send(JOIN_REPLY(msg.ref ?? null, msg.topic ?? 'phoenix'));
        }
      } catch {
        // Non-JSON message — ignore
      }
    });

    socket.on('error', () => {
      // Absorb errors silently; client will reconnect
    });
  });
};

export default realtimePlugin;
