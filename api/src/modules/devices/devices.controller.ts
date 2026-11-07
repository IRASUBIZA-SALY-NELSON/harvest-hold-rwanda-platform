import fs from 'node:fs';
import path from 'node:path';

import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Req, Res, UseGuards } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { ApiError } from '../../common/api-error.js';
import { Database } from '../../common/database.service.js';
import { DeviceGuard } from '../../common/guards.js';
import { config, rules } from '../../config.js';
import { CommandsService } from '../commands/commands.service.js';
import { CropsService } from '../crops/crops.service.js';
import { RoomsService } from '../rooms/rooms.service.js';
import { IngestService } from './ingest.service.js';

/** Endpoints for the ESP32 controller (firmware/harvest_hold_controller). */
@Controller('devices/:id')
@UseGuards(DeviceGuard)
export class DevicesController {
  constructor(
    private db: Database,
    private rooms: RoomsService,
    private crops: CropsService,
    private ingest: IngestService,
    private commands: CommandsService
  ) {}

  /**
   * Readings, either one live reading or a batch (see IngestService). The answer also carries the
   * commands waiting for this room, so a controller that uploads every minute hears about a command
   * without asking again.
   */
  @Post('readings')
  @HttpCode(200)
  @RouteConfig({ rateLimit: { max: 60, timeWindow: '1 minute' } })
  async readings(@Param('id') id: string, @Body() body: any, @Req() req: FastifyRequest) {
    const room = await this.rooms.getRow(id);
    const result = await this.ingest.readings(room, body, 'https', Number(req.headers['x-firmware-version']));
    return { ...result, commands: await this.commands.deliver(room.id, 'https') };
  }

  /** Commands for this room that have not been carried out yet. */
  @Get('commands')
  @RouteConfig({ rateLimit: { max: 60, timeWindow: '1 minute' } })
  async pending(@Param('id') id: string) {
    const room = await this.rooms.getRow(id);
    return { commands: await this.commands.deliver(room.id, 'https') };
  }

  /** The controller reports what it did with a command: { ok: true } or { ok: false, message }. */
  @Post('commands/:commandId/ack')
  @HttpCode(200)
  @RouteConfig({ rateLimit: { max: 60, timeWindow: '1 minute' } })
  async ack(@Param('id') id: string, @Param('commandId', ParseIntPipe) commandId: number, @Body() body: any) {
    const room = await this.rooms.getRow(id);
    await this.commands.ack(room.id, commandId, body?.ok === true, body?.message);
    return { ok: true };
  }

  /** The settings the controller should run with, from the room's crop profile. */
  @Get('profile')
  async profile(@Param('id') id: string) {
    const room = await this.rooms.getRow(id);
    return (await this.crops.get(room.crop)).controller;
  }

  /** The release this room should run: newest on its channel (beta rooms also get stable), never a halted one. */
  private async releaseFor(roomId: string) {
    const room = await this.rooms.getRow(roomId);
    return this.db.one(
      `SELECT version, size, sha256, file_name FROM firmware_releases
        WHERE halted_at IS NULL AND (channel = 'stable' OR (channel = 'beta' AND $1 = 'beta'))
        ORDER BY version DESC LIMIT 1`,
      [room.firmware_channel]
    );
  }

  /** Latest firmware release; the controller installs it if it is newer than its own version. */
  @Get('firmware')
  async firmware(@Param('id') id: string, @Res({ passthrough: true }) reply: FastifyReply) {
    const release = await this.releaseFor(id);
    if (!release) {
      reply.code(204);
      return;
    }
    return { version: release.version, size: release.size, sha256: release.sha256 };
  }

  @Get('firmware/download')
  async download(@Param('id') id: string, @Res() reply: FastifyReply) {
    const release = await this.releaseFor(id);
    const file = release && path.join(config.firmwareDir, path.basename(release.file_name));
    if (!file || !fs.existsSync(file)) throw new ApiError('notFound', 404);
    return reply
      .type('application/octet-stream')
      .header('Content-Length', release.size)
      .header('Cache-Control', 'no-store')
      .send(fs.createReadStream(file));
  }
}
