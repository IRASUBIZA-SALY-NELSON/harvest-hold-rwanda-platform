import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { ApiError } from './api-error.js';

/** Every error goes out as { error: code }; the apps translate the code. */
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly log = new Logger('API');

  catch(err: any, host: ArgumentsHost) {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    if (err instanceof ApiError) return reply.code(err.status).send({ error: err.code, ...(err.details && { details: err.details }) });
    if (err instanceof HttpException) {
      const status = err.getStatus();
      return reply.code(status).send({ error: status === 404 ? 'notFound' : status === 429 ? 'tooManyRequests' : 'unknown' });
    }
    if (err?.statusCode === 429) return reply.code(429).send({ error: 'tooManyRequests' });
    if (err?.statusCode === 413) return reply.code(413).send({ error: 'tooLarge' });
    if (err?.statusCode >= 400 && err?.statusCode < 500) return reply.code(err.statusCode).send({ error: 'unknown' });
    this.log.error(err?.stack ?? err);
    return reply.code(500).send({ error: 'unknown' });
  }
}
