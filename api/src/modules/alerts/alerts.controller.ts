import { Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';

import { Database } from '../../common/database.service.js';
import { CurrentUser, type SessionUser, UserGuard } from '../../common/guards.js';
import { alertView } from '../../common/views.js';

@Controller('alerts')
@UseGuards(UserGuard)
export class AlertsController {
  constructor(private db: Database) {}

  @Get()
  async list(@CurrentUser() u: SessionUser) {
    return (await this.db.query('SELECT * FROM alerts WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200', [u.id])).map(alertView);
  }

  @Get('unread-count')
  async unread(@CurrentUser() u: SessionUser) {
    return { count: (await this.db.one<{ n: number }>('SELECT count(*) AS n FROM alerts WHERE user_id = $1 AND NOT read', [u.id]))?.n ?? 0 };
  }

  @Post('read-all')
  @HttpCode(200)
  async readAll(@CurrentUser() u: SessionUser) {
    await this.db.query('UPDATE alerts SET read = true WHERE user_id = $1', [u.id]);
    return { ok: true };
  }

  @Post(':id/read')
  @HttpCode(200)
  async read(@Param('id') id: string, @CurrentUser() u: SessionUser) {
    await this.db.query('UPDATE alerts SET read = true WHERE id = $1 AND user_id = $2', [id, u.id]);
    return { ok: true };
  }
}
