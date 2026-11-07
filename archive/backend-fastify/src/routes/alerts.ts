import type { FastifyInstance } from 'fastify';

import { requireUser } from '../auth.js';
import { one, query } from '../db.js';
import { alertView } from '../views.js';

export async function alertRoutes(app: FastifyInstance) {
  const signedIn = { preHandler: requireUser };

  app.get('/alerts', signedIn, async (req) => {
    const rows = await query('SELECT * FROM alerts WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200', [req.user!.id]);
    return rows.map(alertView);
  });

  app.get('/alerts/unread-count', signedIn, async (req) => {
    const row = await one<{ n: number }>('SELECT count(*) AS n FROM alerts WHERE user_id = $1 AND NOT read', [req.user!.id]);
    return { count: row?.n ?? 0 };
  });

  app.post<{ Params: { id: string } }>('/alerts/:id/read', signedIn, async (req) => {
    await query('UPDATE alerts SET read = true WHERE id = $1 AND user_id = $2', [req.params.id, req.user!.id]);
    return { ok: true };
  });

  app.post('/alerts/read-all', signedIn, async (req) => {
    await query('UPDATE alerts SET read = true WHERE user_id = $1', [req.user!.id]);
    return { ok: true };
  });
}
