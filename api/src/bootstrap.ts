import 'reflect-metadata';

import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { type INestApplication, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule } from './app.module.js';
import { Database } from './common/database.service.js';
import { migrate } from './common/migrate.js';
import { config, rules } from './config.js';
import { CropsService } from './modules/crops/crops.service.js';

/** Builds the API (shared by the server and the tests). */
export async function createApp({ logger = true }: { logger?: boolean } = {}): Promise<NestFastifyApplication> {
  // forceCloseConnections: open live streams (SSE) must not hold up a restart or deploy.
  const adapter = new FastifyAdapter({ trustProxy: true, bodyLimit: 512 * 1024, forceCloseConnections: true });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    logger: logger ? (config.production ? ['log', 'warn', 'error'] : ['log', 'warn', 'error', 'debug']) : false,
  });
  const fastify = app.getHttpAdapter().getInstance();
  await fastify.register(cors as any, {
    // The mobile app is not a browser; the admin portal calls the API from its own server.
    origin: (origin: string | undefined, cb: (e: Error | null, ok: boolean) => void) => cb(null, !origin || !config.production || origin === config.adminOrigin),
    credentials: true,
  });
  await fastify.register(rateLimit as any, {
    max: 300,
    timeWindow: '1 minute',
    enableDraftSpec: true,
    // Tests skip the per-IP limit; the PIN lockout still applies.
    allowList: () => config.test,
    errorResponseBuilder: (_req: unknown, ctx: { statusCode: number }) => ({ statusCode: ctx.statusCode, error: 'tooManyRequests' }),
  });
  await fastify.register(multipart as any, { limits: { fileSize: rules.photos.maxBytes, files: 1, fields: 5 } });

  const db = app.get(Database);
  await migrate(db.pool, logger ? (s) => Logger.log(s, 'Migrate') : () => {});
  const crops = await app.get(CropsService).syncFromFiles(config.cropProfilesDir);
  if (logger) Logger.log(`crop profiles: ${crops.join(', ') || 'none found in ' + config.cropProfilesDir}`, 'Crops');

  app.enableShutdownHooks();
  await app.init();
  await fastify.ready();
  return app;
}

export type App = INestApplication;
