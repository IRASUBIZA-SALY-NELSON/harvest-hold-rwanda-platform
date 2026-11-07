import { Controller, Get, Param, Res } from '@nestjs/common';
import QRCode from 'qrcode';
import type { FastifyReply } from 'fastify';

import { Database } from '../../common/database.service.js';
import { config } from '../../config.js';
import { SigningService } from '../certificates/signing.service.js';
import { RoomsService } from '../rooms/rooms.service.js';
import { StorageService } from '../storage/storage.service.js';

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const CROP: Record<string, string> = {
  tomato: 'Tomatoes', carrot: 'Carrots', cabbage: 'Cabbage', greenBeans: 'Green beans', avocado: 'Avocados',
  passionFruit: 'Passion fruit', pepper: 'Peppers', spinach: 'Spinach', eggplant: 'Eggplant', mango: 'Mangoes',
};
const RESULT: Record<string, [string, string]> = {
  fresh: ['Kept in the safe range the whole time', '#0B5A2B'],
  attention: ['Conditions left the safe range: check quality', '#C2410C'],
  unknown: ['Not enough data to confirm', '#5E6B62'],
};

const fmtDate = (iso: string | Date) =>
  new Date(iso).toLocaleString('en-GB', { timeZone: 'Africa/Kigali', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function page(title: string, content: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)} · Harvest Hold</title>
<style>
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#F7F8F7;color:#111A14}
main{max-width:560px;margin:0 auto;padding:24px 16px 48px}
.card{background:#fff;border:1px solid #E8EBE8;border-radius:16px;padding:20px;margin-top:16px}
h1{font-size:22px;margin:0}.muted{color:#5E6B62;font-size:14px}
.row{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid #E8EBE8;font-size:15px}
.row:last-child{border-bottom:0}.row span:first-child{color:#5E6B62}.row span:last-child{text-align:right;font-weight:500}
.result{font-weight:600;font-size:16px}
.tag{display:inline-flex;align-items:center;gap:6px;font-size:12px;padding:4px 10px;border-radius:99px;background:#EEF5F0;color:#0B5A2B;font-weight:600}
.tag.bad{background:#FEF1F0;color:#B42318}.tag.warn{background:#FFF4EC;color:#C2410C}
.photos{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px}.photos img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px;border:1px solid #E8EBE8}
.revoked{border-color:#F4C7C3;background:#FEF6F5}
</style></head><body><main><div class="muted">Harvest Hold Rwanda · Certificate check</div>${content}</main></body></html>`;
}

/** Public certificate check behind the QR code. Reads the stored record and checks its signature. */
@Controller()
export class VerifyController {
  constructor(
    private db: Database,
    private rooms: RoomsService,
    private signing: SigningService,
    private storage: StorageService
  ) {}

  /** Anyone can check a certificate's signature with this key. */
  @Get('.well-known/harvest-hold-certificates.pem')
  publicKey(@Res({ passthrough: true }) reply: FastifyReply) {
    reply.type('application/x-pem-file');
    return this.signing.publicKeyPem();
  }

  /** Machine-readable: the signed data, its signature and its standing. */
  @Get('verify/:id.json')
  async json(@Param('id') id: string, @Res({ passthrough: true }) reply: FastifyReply) {
    reply.header('Cache-Control', 'no-store');
    const row = await this.db.one('SELECT * FROM certificates WHERE id = $1', [id.toUpperCase()]);
    if (!row) {
      reply.code(404);
      return { error: 'notFound' };
    }
    return {
      data: row.data,
      signature: row.signature,
      keyId: row.key_id,
      algorithm: 'Ed25519 over canonical JSON (keys sorted)',
      publicKey: `${config.publicBaseUrl}/.well-known/harvest-hold-certificates.pem`,
      signatureValid: this.signing.verify(row.data, row.signature),
      revokedAt: row.revoked_at,
      revokedReason: row.revoked_reason,
    };
  }

  @Get('verify/:id')
  async page(@Param('id') id: string, @Res({ passthrough: true }) reply: FastifyReply) {
    reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store');
    const row = await this.db.one(
      `SELECT c.data, c.signature, c.revoked_at, c.revoked_reason, b.*
         FROM certificates c JOIN batches b ON b.id = c.batch_id WHERE c.id = $1`,
      [id.toUpperCase()]
    );
    if (!row) {
      reply.code(404);
      return page('Not found', `<div class="card"><h1>Certificate not found</h1><p class="muted">No certificate has the number ${esc(id)}. Check the number, or the certificate may be fake.</p></div>`);
    }
    const c = row.data;
    const valid = this.signing.verify(c, row.signature);
    const revoked = !!row.revoked_at;
    const [label, color] = RESULT[c.conditions.freshness] ?? RESULT.unknown;
    const t = (v: number | null) => (v === null ? '–' : `${v}°C`);
    const now = await this.rooms.summarizeBatch(row);
    const [nowLabel, nowColor] = RESULT[now.freshness] ?? RESULT.unknown;
    const photos: string[] = Array.isArray(c.photos) ? c.photos : [];
    const simulated = c.conditions.dataSource === 'simulated' || c.conditions.dataSource === 'mixed';
    const tag = revoked
      ? `<span class="tag bad">Revoked: do not rely on this certificate</span>`
      : !row.signature
        ? `<span class="tag warn">Issued before digital signing</span>`
        : valid
          ? `<span class="tag">✓ Genuine: digitally signed by Harvest Hold${c.status === 'internal' ? ' · internal, not yet RSB/NAEB certified' : ''}</span>`
          : `<span class="tag bad">Signature does not match: this record was altered</span>`;
    return page(
      c.id,
      `${revoked ? `<div class="card revoked"><h1 style="color:#B42318">Revoked</h1><p class="muted">Revoked on ${esc(fmtDate(row.revoked_at))}. Reason: ${esc(row.revoked_reason)}</p></div>` : ''}
      <div class="card">${tag}
        <h1 style="margin-top:12px">${esc(CROP[c.batch.crop] ?? c.batch.crop)} · ${esc(c.batch.quantity)} ${esc(c.batch.unit === 'crate' && c.batch.quantity !== 1 ? 'crates' : c.batch.unit)}</h1>
        <p class="muted">Certificate ${esc(c.id)}, issued ${esc(fmtDate(c.issuedAt))}</p>
        <p class="result" style="color:${color}">${esc(label)}</p>
        ${simulated ? `<p><span class="tag warn">Test data: includes ${esc(c.conditions.simulatedSamples)} simulated readings, not from a real controller</span></p>` : ''}
        <div class="row"><span>Farmer</span><span>${esc(c.farmer?.name)}</span></div>
        <div class="row"><span>Cold room</span><span>${esc(c.coldRoom.name)}, ${esc(c.coldRoom.district)}</span></div>
        <div class="row"><span>Stored since</span><span>${esc(fmtDate(c.batch.storedAt))}</span></div>
        <div class="row"><span>Time in storage</span><span>${esc(c.conditions.hoursStored)} h</span></div>
        <div class="row"><span>Safe range</span><span>${esc(c.conditions.safeMin)}–${esc(c.conditions.safeMax)}°C, ${esc(c.conditions.humidityMin)}–${esc(c.conditions.humidityMax)}% humidity</span></div>
        <div class="row"><span>Average temperature</span><span>${esc(t(c.conditions.avgTemp))}</span></div>
        <div class="row"><span>Temperature range</span><span>${esc(t(c.conditions.minTemp))} – ${esc(t(c.conditions.maxTemp))}</span></div>
        <div class="row"><span>Average humidity</span><span>${c.conditions.avgHumidity === null ? '–' : esc(c.conditions.avgHumidity) + '%'}</span></div>
        <div class="row"><span>Time outside safe range</span><span>${esc(c.conditions.minutesOutOfRange)} min</span></div>
        <div class="row"><span>Time without data</span><span>${esc(c.conditions.minutesNoData)} min</span></div>
        ${photos.length ? `<div class="muted" style="margin-top:14px">Photos taken when the crop was stored</div><div class="photos">${photos.map((p) => `<img src="/media/${esc(p)}?size=thumb" alt="Crop at check-in">`).join('')}</div>` : ''}
      </div>
      <div class="card"><div class="muted">Right now</div>
        <p class="result" style="color:${row.status === 'stored' ? nowColor : '#5E6B62'}">${row.status === 'stored' ? `Still in the cold room: ${esc(nowLabel.toLowerCase())}` : 'No longer in the cold room'}</p>
        <p class="muted">This page reads the cold room's sensor records directly. The details above were fixed and signed when the certificate was issued; any change to them would break the signature.
        <a href="/verify/${esc(c.id)}.json">Signed data</a></p>
      </div>`
    );
  }

  /** The QR code of a batch, as an image. It opens the public trace page. */
  @Get('trace/:code/qr.svg')
  async qr(@Param('code') code: string, @Res({ passthrough: true }) reply: FastifyReply) {
    const batch = await this.db.one('SELECT code FROM batches WHERE code = $1', [code.toUpperCase()]);
    if (!batch) {
      reply.code(404);
      return '';
    }
    reply.type('image/svg+xml').header('Cache-Control', 'public, max-age=86400');
    return QRCode.toString(`${config.publicBaseUrl}/trace/${batch.code}`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  }

  /** Public traceability page behind a batch's QR code: where it came from, where it is and what happened to it. */
  @Get('trace/:code')
  async trace(@Param('code') code: string, @Res({ passthrough: true }) reply: FastifyReply) {
    reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store');
    const batch = await this.db.one(
      `SELECT b.*, u.name AS farmer_name, co.name AS cooperative_name FROM batches b
         JOIN users u ON u.id = b.farmer_id LEFT JOIN cooperatives co ON co.id = b.cooperative_id WHERE b.code = $1`,
      [code.toUpperCase()]
    );
    if (!batch) {
      reply.code(404);
      return page('Not found', `<div class="card"><h1>Batch not found</h1><p class="muted">No batch has the code ${esc(code)}.</p></div>`);
    }
    const room = await this.rooms.getRow(batch.cold_room_id);
    const now = await this.rooms.summarizeBatch(batch);
    const [nowLabel, nowColor] = RESULT[now.freshness] ?? RESULT.unknown;
    const movements = await this.storage.movementsOfBatch(batch.id);
    const cert = await this.db.one('SELECT id, issued_at, revoked_at FROM certificates WHERE batch_id = $1 ORDER BY issued_at DESC LIMIT 1', [batch.id]);
    const inRoom = batch.status === 'stored';
    const REASON: Record<string, string> = { checkin: 'Stored', collection: 'Collected', sale: 'Sold', removed: 'Taken out' };
    const unit = (q: number) => (batch.unit === 'crate' && q !== 1 ? 'crates' : batch.unit);
    return page(
      batch.code,
      `<div class="card"><span class="tag">Batch ${esc(batch.code)}</span>
        <h1 style="margin-top:12px">${esc(CROP[batch.crop] ?? batch.crop)}</h1>
        <p class="result" style="color:${inRoom ? nowColor : '#5E6B62'}">${inRoom ? `In the cold room: ${esc(nowLabel.toLowerCase())}` : 'No longer in the cold room'}</p>
        ${now.dataSource === 'simulated' || now.dataSource === 'mixed' ? '<p><span class="tag warn">Test data: includes simulated readings</span></p>' : ''}
        <div class="row"><span>Farmer</span><span>${esc(batch.farmer_name)}</span></div>
        ${batch.cooperative_name ? `<div class="row"><span>Cooperative</span><span>${esc(batch.cooperative_name)}</span></div>` : ''}
        <div class="row"><span>Harvested</span><span>${batch.harvest_date ? esc(new Date(`${batch.harvest_date}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' })) : '–'}</span></div>
        <div class="row"><span>Stored since</span><span>${esc(fmtDate(batch.stored_at))}</span></div>
        <div class="row"><span>Cold room</span><span>${esc(room.name)} (${esc(room.id)}), ${esc(room.district)}</span></div>
        ${batch.storage_location ? `<div class="row"><span>Spot in the room</span><span>${esc(batch.storage_location)}</span></div>` : ''}
        <div class="row"><span>Quantity</span><span>${esc(batch.initial_quantity)} ${esc(unit(batch.initial_quantity))} stored, ${esc(batch.quantity)} left</span></div>
        <div class="row"><span>Time outside safe range</span><span>${esc(now.minutesOutOfRange)} min</span></div>
        <div class="row"><span>Time without data</span><span>${esc(now.minutesNoData)} min</span></div>
      </div>
      <div class="card"><div class="muted">What happened to it</div>
        ${movements.map((m) => `<div class="row"><span>${esc(fmtDate(m.at))}</span><span>${esc(REASON[m.reason] ?? m.reason)}: ${esc(m.quantity)} ${esc(unit(m.quantity))}</span></div>`).join('')}
      </div>
      ${cert ? `<div class="card"><div class="muted">Freshness certificate</div><p><a href="/verify/${esc(cert.id)}">${esc(cert.id)}</a>${cert.revoked_at ? ' (revoked)' : ''}</p></div>` : ''}`
    );
  }
}
