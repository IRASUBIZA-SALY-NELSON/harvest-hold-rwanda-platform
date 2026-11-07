import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { Body, Controller, Get, HttpCode, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { ApiError, notFound } from '../../common/api-error.js';
import { Database } from '../../common/database.service.js';
import { config } from '../../config.js';
import { type Actor, AuditService } from '../audit/audit.service.js';
import { CropsService, validateProfile } from '../crops/crops.service.js';
import { RoomsService } from '../rooms/rooms.service.js';
import { AdminActor, AdminGuard, AdminRoles } from './admin.guard.js';

const MAX_FIRMWARE = 1_835_008; // one app slot in partitions.csv (0x1C0000)

/** Paths in a JSON value whose content differs, for a readable audit summary. */
function changedPaths(a: any, b: any, prefix = ''): string[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b || Array.isArray(a) || Array.isArray(b)) return [prefix || '(root)'];
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((k) => changedPaths(a[k], b[k], prefix ? `${prefix}.${k}` : k));
}

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminOpsController {
  constructor(
    private db: Database,
    private crops: CropsService,
    private rooms: RoomsService,
    private audit: AuditService
  ) {}

  // ---------- Firmware ----------

  /** Releases with how many rooms run each one, and every room's version (the rollout picture). */
  @Get('firmware')
  async firmware() {
    const releases = await this.db.query(
      `SELECT f.*, a.name AS created_by_name,
              (SELECT count(*) FROM cold_rooms c WHERE c.firmware_version = f.version AND c.status <> 'retired') AS rooms_running
         FROM firmware_releases f LEFT JOIN admins a ON a.id = f.created_by ORDER BY f.version DESC`
    );
    const rooms = await this.db.query("SELECT id, name, firmware_version, firmware_channel, last_upload_at, status FROM cold_rooms WHERE status <> 'retired' ORDER BY name");
    const offered = (channel: string) => releases.find((r) => !r.halted_at && (r.channel === 'stable' || channel === 'beta'))?.version ?? null;
    return {
      releases: releases.map((r) => ({
        version: r.version, channel: r.channel, size: r.size, sha256: r.sha256, notes: r.notes, createdAt: r.created_at, createdBy: r.created_by_name,
        haltedAt: r.halted_at, roomsRunning: r.rooms_running,
      })),
      rooms: rooms.map((r) => ({
        id: r.id, name: r.name, status: r.status, channel: r.firmware_channel, version: r.firmware_version, lastUploadAt: r.last_upload_at,
        offered: offered(r.firmware_channel),
        upToDate: r.firmware_version !== null && r.firmware_version >= (offered(r.firmware_channel) ?? 0),
      })),
    };
  }

  /**
   * Upload a build (multipart: fields `version`, `channel`, `notes`, then `file` = harvest_hold_controller.ino.bin).
   * Checked: ESP32 image header, size fits an update slot, version higher than any release.
   */
  @Post('firmware')
  @HttpCode(200)
  @AdminRoles('operations')
  async upload(@Req() req: FastifyRequest, @AdminActor() actor: Actor) {
    if (!req.isMultipart()) throw new ApiError('invalidFirmware', 415);
    const part = await req.file({ limits: { fileSize: MAX_FIRMWARE + 1, files: 1 } });
    if (!part) throw new ApiError('invalidFirmware', 415);
    const field = (n: string) => (part.fields as any)[n]?.value as string | undefined;
    const data = await part.toBuffer().catch(() => {
      throw new ApiError('firmwareTooLarge', 413);
    });
    const version = Number(field('version'));
    const channel = field('channel') === 'beta' ? 'beta' : 'stable';
    const notes = (field('notes') ?? '').slice(0, 2000);
    if (!Number.isInteger(version) || version < 1) throw new ApiError('invalidVersion');
    if (data.length > MAX_FIRMWARE) throw new ApiError('firmwareTooLarge', 413);
    if (data[0] !== 0xe9) throw new ApiError('invalidFirmware', 415); // ESP32 app image magic byte
    const latest = await this.db.one<{ v: number | null }>('SELECT max(version) AS v FROM firmware_releases');
    if (latest?.v && version <= latest.v) throw new ApiError('versionNotHigher', 409, { latest: latest.v });
    const sha256 = crypto.createHash('sha256').update(data).digest('hex');
    const fileName = `harvest-hold-v${version}.bin`;
    await fs.mkdir(config.firmwareDir, { recursive: true });
    await fs.writeFile(path.join(config.firmwareDir, fileName), data);
    await this.db.query('INSERT INTO firmware_releases (version, file_name, size, sha256, notes, channel, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)', [
      version, fileName, data.length, sha256, notes, channel, actor.id,
    ]);
    await this.audit.record(actor, { action: 'firmware.release', entityType: 'firmware', entityId: String(version), summary: `Released firmware v${version} to ${channel} rooms (${data.length} bytes, sha256 ${sha256.slice(0, 12)}…)`, after: { version, channel, sha256, notes } });
    return { version, channel, size: data.length, sha256 };
  }

  /** Beta went well: every room gets it. */
  @Post('firmware/:version/promote')
  @HttpCode(200)
  @AdminRoles('operations')
  async promote(@Param('version') v: string, @AdminActor() actor: Actor) {
    const r = await this.db.one("UPDATE firmware_releases SET channel = 'stable' WHERE version = $1 AND channel = 'beta' RETURNING *", [Number(v)]);
    if (!r) throw notFound();
    await this.audit.record(actor, { action: 'firmware.promote', entityType: 'firmware', entityId: v, summary: `Promoted firmware v${v} from beta to all rooms` });
    return { ok: true };
  }

  /** Stops offering a release. Rooms that already installed it keep it; the others stay where they are. */
  @Post('firmware/:version/halt')
  @HttpCode(200)
  @AdminRoles('operations')
  async halt(@Param('version') v: string, @Body() b: any, @AdminActor() actor: Actor) {
    const reason = typeof b?.reason === 'string' && b.reason.trim().length >= 5 ? b.reason.trim() : null;
    if (!reason) throw new ApiError('reasonRequired');
    const r = await this.db.one('UPDATE firmware_releases SET halted_at = now() WHERE version = $1 AND halted_at IS NULL RETURNING *', [Number(v)]);
    if (!r) throw notFound();
    await this.audit.record(actor, { action: 'firmware.halt', entityType: 'firmware', entityId: v, summary: `Halted firmware v${v}: ${reason}` });
    return { ok: true };
  }

  @Post('firmware/:version/resume')
  @HttpCode(200)
  @AdminRoles('operations')
  async resume(@Param('version') v: string, @AdminActor() actor: Actor) {
    const r = await this.db.one('UPDATE firmware_releases SET halted_at = NULL WHERE version = $1 RETURNING *', [Number(v)]);
    if (!r) throw notFound();
    await this.audit.record(actor, { action: 'firmware.resume', entityType: 'firmware', entityId: v, summary: `Resumed offering firmware v${v}` });
    return { ok: true };
  }

  // ---------- Crop profiles ----------

  @Get('crops')
  async cropsList() {
    const rows = await this.db.query(
      `SELECT p.crop, p.version, p.data, p.updated_at,
              (SELECT count(*) FROM cold_rooms c WHERE c.crop = p.crop AND c.status <> 'retired') AS rooms
         FROM crop_profiles p ORDER BY p.crop`
    );
    return rows.map((r) => ({ crop: r.crop, version: r.version, updatedAt: r.updated_at, rooms: r.rooms, data: r.data }));
  }

  /**
   * Edits a crop profile. It must pass the same safety checks as the firmware, its version goes
   * up by one, rooms pick it up within 10 minutes, and the audit trail records exactly what changed.
   */
  @Put('crops/:crop')
  @AdminRoles('operations')
  async updateCrop(@Param('crop') crop: string, @Body() b: any, @AdminActor() actor: Actor) {
    const current = await this.db.one('SELECT * FROM crop_profiles WHERE crop = $1', [crop]);
    if (!current) throw notFound();
    const reason = typeof b?.reason === 'string' && b.reason.trim().length >= 10 ? b.reason.trim() : null;
    if (!reason) throw new ApiError('reasonRequired');
    const version = current.version + 1;
    const next = { ...b.data, crop, version, controller: { ...(b.data?.controller ?? {}), crop, version } };
    try {
      validateProfile(next, crop);
    } catch {
      throw new ApiError('unsafeProfile', 422);
    }
    const changed = changedPaths(current.data, next).filter((p) => !p.endsWith('version'));
    if (!changed.length) return { ok: true, version: current.version };
    await this.db.query('UPDATE crop_profiles SET data = $2, version = $3, updated_at = now() WHERE crop = $1', [crop, next, version]);
    this.crops.clearCache();
    this.rooms.clearSummaryCache();
    await this.audit.record(actor, {
      action: 'crop.update',
      entityType: 'crop',
      entityId: crop,
      summary: `Changed the ${crop} profile to v${version} (${changed.join(', ')}): ${reason}`,
      before: Object.fromEntries(changed.map((p) => [p, p.split('.').reduce((o: any, k) => o?.[k], current.data)])),
      after: Object.fromEntries(changed.map((p) => [p, p.split('.').reduce((o: any, k) => o?.[k], next)])),
    });
    return { ok: true, version };
  }
}
