import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';

import { config } from './config.js';
import { pool } from './db.js';
import { ApiError } from './errors.js';
import { alertRoutes } from './routes/alerts.js';
import { authRoutes } from './routes/auth.js';
import { deviceRoutes } from './routes/devices.js';
import { marketRoutes } from './routes/market.js';
import { roomRoutes } from './routes/rooms.js';
import { stockRoutes } from './routes/stock.js';
import { verifyRoutes } from './routes/verify.js';

export async function buildApp({ logger = !process.env.VITEST } = {}) {
  const app = Fastify({
    logger: logger && { level: config.production ? 'info' : 'warn', redact: ['req.headers.authorization'] },
    trustProxy: true,
    bodyLimit: 64 * 1024,
  });

  await app.register(cors, { origin: true });
  // Per-IP limits. Tests skip them; the per-phone code limit and PIN lockout still apply.
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute', enableDraftSpec: true, allowList: () => !!process.env.VITEST });

  // Every error goes out as { error: code }; the app translates the code.
  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof ApiError) return reply.code(err.status).send({ error: err.code });
    if (err.statusCode === 429) return reply.code(429).send({ error: 'tooManyRequests' });
    if (err.validation || err.statusCode === 400) return reply.code(400).send({ error: 'unknown' });
    req.log.error(err);
    return reply.code(500).send({ error: 'unknown' });
  });
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'notFound' }));

  app.get('/health', async (_req, reply) => {
    try {
      await pool.query('SELECT 1');
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });

  await app.register(authRoutes);
  await app.register(roomRoutes);
  await app.register(stockRoutes);
  await app.register(marketRoutes);
  await app.register(alertRoutes);
  await app.register(deviceRoutes);
  await app.register(verifyRoutes);
  return app;
}
