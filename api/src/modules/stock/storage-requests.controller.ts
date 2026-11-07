import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { ApiError, notAllowed, notFound } from '../../common/api-error.js';
import { Database } from '../../common/database.service.js';
import { CurrentUser, Roles, type SessionUser, UserGuard } from '../../common/guards.js';
import { newId } from '../../common/ids.js';
import { CROPS, oneOf, optionalText, positiveInt, UNITS } from '../../common/validate.js';
import { AuditService } from '../audit/audit.service.js';
import { CropsService } from '../crops/crops.service.js';
import { RoomsService } from '../rooms/rooms.service.js';

export const requestView = (r: any) => ({
  id: r.id,
  coldRoomId: r.cold_room_id,
  crop: r.crop,
  unit: r.unit,
  estimatedQuantity: r.estimated_quantity,
  note: r.note,
  status: r.status as 'pending' | 'accepted' | 'declined' | 'cancelled',
  /** What the operator weighed and confirmed. */
  confirmedQuantity: r.confirmed_quantity,
  batchId: r.batch_id,
  batchCode: r.batch_code ?? null,
  declineReason: r.decline_reason,
  createdAt: r.created_at,
  handledAt: r.handled_at,
});

const MAX_PENDING = 5;

/**
 * A farmer asks to store produce. They do not record stock themselves: an operator at the cold room
 * weighs and inspects it, confirms the real quantity and registers it (see the portal's Storage requests).
 */
@Controller('storage-requests')
@UseGuards(UserGuard)
@Roles('farmer')
export class StorageRequestsController {
  constructor(
    private db: Database,
    private rooms: RoomsService,
    private crops: CropsService,
    private audit: AuditService
  ) {}

  @Get()
  async mine(@CurrentUser() u: SessionUser) {
    const rows = await this.db.query(
      `SELECT r.*, b.code AS batch_code FROM storage_requests r LEFT JOIN batches b ON b.id = r.batch_id
        WHERE r.farmer_id = $1 ORDER BY r.created_at DESC LIMIT 100`,
      [u.id]
    );
    return rows.map(requestView);
  }

  @Post()
  @HttpCode(200)
  async create(@Body() b: any, @CurrentUser() u: SessionUser, @Req() req: FastifyRequest) {
    b ??= {};
    const crop = oneOf(b.crop, CROPS, 'cropRequired');
    const quantity = positiveInt(b.quantity, 'invalidQuantity', 100_000);
    const unit = oneOf(b.unit, UNITS, 'invalidQuantity');
    const room = await this.rooms.getRow(u.cold_room_id!);
    if (room.status !== 'active') throw new ApiError('roomNotActive');
    if (!this.crops.canShareRoom(await this.crops.get(room.crop), crop)) throw new ApiError('cropNotAllowedInRoom');
    const open = await this.db.one<{ n: number }>("SELECT count(*)::int AS n FROM storage_requests WHERE farmer_id = $1 AND status = 'pending'", [u.id]);
    if (open!.n >= MAX_PENDING) throw new ApiError('tooManyRequests', 429);
    const row = await this.db.one(
      'INSERT INTO storage_requests (id, farmer_id, cold_room_id, crop, unit, estimated_quantity, note) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [newId('sr'), u.id, room.id, crop, unit, quantity, optionalText(b.note, 300)]
    );
    await this.audit.record({ type: 'user', id: u.id, name: u.name, ip: req.ip }, {
      action: 'storageRequest.create', entityType: 'storageRequest', entityId: row.id,
      summary: `${u.name} asked to store about ${quantity} ${unit} of ${crop} at ${room.name}`,
    });
    return requestView(row);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(@Param('id') id: string, @CurrentUser() u: SessionUser) {
    const r = await this.db.one('SELECT * FROM storage_requests WHERE id = $1', [id]);
    if (!r) throw notFound();
    if (r.farmer_id !== u.id) throw notAllowed();
    const row = await this.db.one("UPDATE storage_requests SET status = 'cancelled', handled_at = now() WHERE id = $1 AND status = 'pending' RETURNING *", [id]);
    if (!row) throw new ApiError('requestClosed', 409);
    return requestView(row);
  }
}
