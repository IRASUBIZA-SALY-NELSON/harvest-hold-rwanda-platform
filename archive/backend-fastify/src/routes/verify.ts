import type { FastifyInstance } from 'fastify';

import { one } from '../db.js';
import { summarizeBatch } from '../rooms.js';

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

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { timeZone: 'Africa/Kigali', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function page(title: string, content: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Harvest Hold</title>
<style>
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#F7F8F7;color:#111A14}
main{max-width:520px;margin:0 auto;padding:24px 16px 48px}
.card{background:#fff;border:1px solid #E8EBE8;border-radius:16px;padding:20px;margin-top:16px}
h1{font-size:22px;margin:0}.muted{color:#5E6B62;font-size:14px}
.row{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid #E8EBE8;font-size:15px}
.row:last-child{border-bottom:0}.row span:first-child{color:#5E6B62}.row span:last-child{text-align:right;font-weight:500}
.result{font-weight:600;font-size:16px}.tag{display:inline-block;font-size:12px;padding:3px 8px;border-radius:99px;background:#EEF5F0;color:#0B5A2B}
</style></head><body><main><div class="muted">Harvest Hold Rwanda · Certificate check</div>${content}</main></body></html>`;
}

export async function verifyRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>('/verify/:id', async (req, reply) => {
    reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store');
    const row = await one('SELECT c.data, b.* FROM certificates c JOIN batches b ON b.id = c.batch_id WHERE c.id = $1', [req.params.id.toUpperCase()]);
    if (!row) {
      reply.code(404);
      return page('Not found', `<div class="card"><h1>Certificate not found</h1><p class="muted">No certificate has the number ${esc(req.params.id)}. Check the number, or the certificate may be fake.</p></div>`);
    }
    const c = row.data;
    const [label, color] = RESULT[c.conditions.freshness] ?? RESULT.unknown;
    const t = (v: number | null) => (v === null ? '–' : `${v}°C`);
    const now = await summarizeBatch(row);
    const [nowLabel, nowColor] = RESULT[now.freshness] ?? RESULT.unknown;
    return page(
      c.id,
      `<div class="card"><span class="tag">Genuine Harvest Hold certificate${c.status === 'internal' ? ' · internal, not yet RSB/NAEB certified' : ''}</span>
        <h1 style="margin-top:12px">${esc(CROP[c.batch.crop] ?? c.batch.crop)} · ${esc(c.batch.quantity)} ${esc(c.batch.unit === 'crate' && c.batch.quantity !== 1 ? 'crates' : c.batch.unit)}</h1>
        <p class="muted">Certificate ${esc(c.id)}, issued ${esc(fmtDate(c.issuedAt))}</p>
        <p class="result" style="color:${color}">${esc(label)}</p>
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
      </div>
      <div class="card"><div class="muted">Right now</div>
        <p class="result" style="color:${row.status === 'stored' ? nowColor : '#5E6B62'}">${row.status === 'stored' ? `Still in the cold room: ${esc(nowLabel.toLowerCase())}` : 'No longer in the cold room'}</p>
        <p class="muted">This page reads the cold room's sensor records directly. The details above were fixed when the certificate was issued and cannot be changed.</p>
      </div>`
    );
  });
}
