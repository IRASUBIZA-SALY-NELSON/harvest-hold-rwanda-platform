import type { FastifyInstance } from 'fastify';

import { requireUser } from '../auth.js';
import { query } from '../db.js';
import { notAllowed } from '../errors.js';
import { energyToday, getRoomRow, history, latestReading, roomView, summarizeRoom } from '../rooms.js';

const DAY = 86_400_000;

export async function roomRoutes(app: FastifyInstance) {
  // Public: the sign-up screen lists cold rooms.
  app.get('/cold-rooms', async () => {
    const rooms = await query('SELECT * FROM cold_rooms ORDER BY name');
    return Promise.all(rooms.map(roomView));
  });

  app.get<{ Params: { id: string } }>('/cold-rooms/:id', { preHandler: requireUser }, async (req) => roomView(await getRoomRow(req.params.id)));

  /** Live status: only for farmers who use this room. */
  app.get<{ Params: { id: string } }>('/cold-rooms/:id/status', { preHandler: requireUser }, async (req) => {
    if (req.user!.cold_room_id !== req.params.id) throw notAllowed();
    const room = await getRoomRow(req.params.id);
    const [crates] = await query<{ n: number }>(
      // kg are counted as 20 kg crates.
      "SELECT coalesce(sum(CASE WHEN unit = 'crate' THEN quantity ELSE ceil(quantity / 20.0) END), 0)::int AS n FROM batches WHERE cold_room_id = $1 AND status = 'stored'",
      [room.id]
    );
    return {
      room: await roomView(room),
      reading: await latestReading(room.id),
      last24h: await summarizeRoom(room, Date.now() - DAY),
      storedCrates: crates.n,
      /** Wh used by the cooler since midnight (Peltier rooms with a power meter), else null. */
      energyTodayWh: room.cooling_type === 'peltier' ? await energyToday(room.id) : null,
    };
  });

  app.get<{ Params: { id: string }; Querystring: { range?: string } }>('/cold-rooms/:id/history', { preHandler: requireUser }, async (req) => {
    if (req.user!.cold_room_id !== req.params.id) throw notAllowed();
    await getRoomRow(req.params.id);
    return history(req.params.id, req.query.range === '7d' ? '7d' : '24h');
  });
}
