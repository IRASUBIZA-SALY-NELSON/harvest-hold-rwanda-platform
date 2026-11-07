import { Controller, Delete, Get, HttpCode, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { RouteConfig } from '@nestjs/platform-fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { ApiError, notAllowed, notFound } from '../../common/api-error.js';
import { Database } from '../../common/database.service.js';
import { CurrentUser, type SessionUser, UserGuard } from '../../common/guards.js';
import { rules } from '../../config.js';
import { AuditService } from '../audit/audit.service.js';
import { MediaService, type PhotoKind } from './media.service.js';

const KINDS: PhotoKind[] = ['listing', 'checkin', 'profile'];

@Controller()
export class MediaController {
  constructor(
    private db: Database,
    private media: MediaService,
    private audit: AuditService
  ) {}

  /**
   * Upload one photo (multipart/form-data): fields `kind` (listing | checkin | profile) and
   * `entityId` (listing or batch id; not needed for profile), then the `file`.
   * Only the owner of the listing or batch can add photos to it.
   */
  @Post('photos')
  @HttpCode(200)
  @UseGuards(UserGuard)
  @RouteConfig({ rateLimit: { max: 30, timeWindow: '1 minute' } })
  async upload(@Req() req: FastifyRequest, @CurrentUser() u: SessionUser) {
    if (!req.isMultipart()) throw new ApiError('unsupportedImage', 415);
    let part;
    try {
      part = await req.file({ limits: { fileSize: rules.photos.maxBytes, files: 1 } });
    } catch {
      throw new ApiError('unsupportedImage', 415);
    }
    if (!part) throw new ApiError('unsupportedImage', 415);
    const field = (name: string) => {
      const f = (part.fields as any)[name];
      return typeof f?.value === 'string' ? f.value : undefined;
    };
    const kind = field('kind') as PhotoKind;
    if (!KINDS.includes(kind)) throw new ApiError('unsupportedImage', 415);
    let buffer: Buffer;
    try {
      buffer = await part.toBuffer();
    } catch {
      throw new ApiError('imageTooLarge', 413);
    }

    let entityId: string;
    if (kind === 'profile') {
      entityId = u.id;
    } else {
      entityId = field('entityId') ?? '';
      const table = kind === 'listing' ? 'listings' : 'batches';
      const owner = await this.db.one<{ farmer_id: string }>(`SELECT farmer_id FROM ${table} WHERE id = $1`, [entityId]);
      if (!owner) throw notFound();
      if (owner.farmer_id !== u.id) throw notAllowed();
      const max = kind === 'listing' ? rules.photos.maxPerListing : rules.photos.maxPerBatch;
      const count = (await this.db.one<{ n: number }>("SELECT count(*) AS n FROM photos WHERE kind = $1 AND entity_id = $2 AND status = 'active'", [kind, entityId]))!.n;
      if (count >= max) throw new ApiError('tooManyPhotos');
    }

    const photo = await this.media.save(u.id, kind, entityId, buffer);
    if (kind === 'profile') {
      // One profile photo: the new one replaces the old.
      await this.db.query("UPDATE photos SET status = 'removed', removed_by = 'owner', removed_at = now() WHERE kind = 'profile' AND owner_id = $1 AND id <> $2 AND status = 'active'", [u.id, photo!.id]);
      await this.db.query('UPDATE users SET photo_id = $2 WHERE id = $1', [u.id, photo!.id]);
    }
    await this.audit.record(
      { type: 'user', id: u.id, name: u.name, ip: req.ip },
      { action: 'photo.upload', entityType: kind === 'profile' ? 'user' : kind === 'listing' ? 'listing' : 'batch', entityId, summary: `${u.name} added a ${kind} photo`, after: { photoId: photo!.id } }
    );
    return { id: photo!.id, width: photo!.width, height: photo!.height };
  }

  @Delete('photos/:id')
  @UseGuards(UserGuard)
  async remove(@Param('id') id: string, @CurrentUser() u: SessionUser, @Req() req: FastifyRequest) {
    const photo = await this.db.one('SELECT * FROM photos WHERE id = $1', [id]);
    if (!photo || photo.status !== 'active') throw notFound();
    if (photo.owner_id !== u.id) throw notAllowed();
    await this.media.remove(id, 'owner', null);
    if (photo.kind === 'profile') await this.db.query('UPDATE users SET photo_id = NULL WHERE id = $1 AND photo_id = $2', [u.id, id]);
    await this.audit.record({ type: 'user', id: u.id, name: u.name, ip: req.ip }, { action: 'photo.remove', entityType: 'photo', entityId: id, summary: `${u.name} removed a ${photo.kind} photo` });
    return { ok: true };
  }

  /** Photo files. Ids are random, so they work as unguessable links; removed photos are gone. */
  @Get('media/:id')
  async serve(@Param('id') id: string, @Query('size') size: string, @Res() reply: FastifyReply) {
    if (!this.media.isValidId(id)) throw notFound();
    const photo = await this.db.one("SELECT 1 FROM photos WHERE id = $1 AND status = 'active'", [id]);
    if (!photo) throw notFound();
    const data = await this.media.read(id, size === 'thumb' ? 'thumb' : 'full');
    if (!data) throw notFound();
    return reply
      .type('image/webp')
      .header('Cache-Control', 'public, max-age=3600')
      .header('X-Content-Type-Options', 'nosniff')
      .send(data);
  }
}
