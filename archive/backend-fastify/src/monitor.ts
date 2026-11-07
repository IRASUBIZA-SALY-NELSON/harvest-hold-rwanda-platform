import { rules } from './config.js';
import { query } from './db.js';
import { notifyRoom, type Params } from './notify.js';
import { roomConditions, type RoomRow } from './rooms.js';

const MIN = 60_000;

interface Check {
  type: string;
  bad: boolean;
  /** For alerts with hysteresis: only clear when this is true. Defaults to !bad. */
  ok?: boolean;
  graceMin: number;
  params: Params;
  /** Send "back to normal" when it clears. */
  announceRecovery: boolean;
}

/** Called for every reading a controller uploads. */
export async function evaluateReading(room: RoomRow, r: any, now = Date.now()) {
  const c = await roomConditions(room);
  const coldest = [r.chamber, r.coil_outlet].filter((v) => v !== null && v !== undefined) as number[];
  const minTemp = coldest.length ? Math.min(...coldest) : null;

  const checks: Check[] = [
    { type: 'chamberWarm', bad: r.chamber !== null && r.chamber > c.safeMax, graceMin: c.excursionGraceMin, params: { room: room.name, temp: r.chamber, max: c.safeMax }, announceRecovery: true },
    { type: 'chamberCold', bad: minTemp !== null && minTemp < c.safeMin, graceMin: rules.coldAlertMin, params: { room: room.name, temp: minTemp ?? '' }, announceRecovery: true },
    { type: 'humidityLow', bad: r.humidity !== null && r.humidity < c.humidityMin, graceMin: c.humidityGraceMin, params: { room: room.name, humidity: Math.round(r.humidity ?? 0) }, announceRecovery: false },
    { type: 'batteryLow', bad: r.battery !== null && r.battery <= rules.batteryLowPercent, ok: r.battery === null || r.battery >= rules.batteryOkPercent, graceMin: 0, params: { room: room.name, battery: r.battery ?? '' }, announceRecovery: false },
  ];
  const deviceSays = (code: string) => (r.device_alerts ?? []).includes(code);
  if (room.cooling_type === 'ice_bank') {
    checks.push({ type: 'iceLow', bad: deviceSays('ice_bank_low'), graceMin: 0, params: { room: room.name }, announceRecovery: false });
  } else {
    // Peltier: the hot side burns the module out if it overheats; the controller also reports faults it detects.
    checks.push(
      {
        type: 'coolerOverheat',
        bad: deviceSays('hot_side_overheat') || (r.hot_side !== null && r.hot_side !== undefined && r.hot_side > rules.hotSideAlertC),
        graceMin: 0,
        params: { room: room.name, temp: r.hot_side === null || r.hot_side === undefined ? '' : Math.round(r.hot_side) },
        announceRecovery: true,
      },
      { type: 'coolerFault', bad: deviceSays('cooler_fault'), graceMin: 0, params: { room: room.name }, announceRecovery: true },
      { type: 'coolingCapacity', bad: deviceSays('cooling_capacity'), graceMin: 0, params: { room: room.name }, announceRecovery: false }
    );
  }

  // Data arrived, so the room is no longer offline.
  await query("DELETE FROM room_alert_state WHERE room_id = $1 AND type = 'offline'", [room.id]);

  for (const check of checks) {
    const [state] = await query<{ since: Date; notified: boolean }>('SELECT since, notified FROM room_alert_state WHERE room_id = $1 AND type = $2', [room.id, check.type]);
    if (check.bad) {
      const since = state ? state.since.getTime() : now;
      if (!state) await query('INSERT INTO room_alert_state (room_id, type, since) VALUES ($1, $2, $3)', [room.id, check.type, new Date(now)]);
      if (!state?.notified && now - since >= check.graceMin * MIN) {
        await query('UPDATE room_alert_state SET notified = true WHERE room_id = $1 AND type = $2', [room.id, check.type]);
        await notifyRoom(room.id, check.type, check.params);
      }
    } else if (state && (check.ok ?? true)) {
      await query('DELETE FROM room_alert_state WHERE room_id = $1 AND type = $2', [room.id, check.type]);
      if (state.notified && check.announceRecovery) await notifyRoom(room.id, 'backToNormal', { room: room.name });
    }
  }
}

/** Runs every minute: warns farmers when a room has stopped sending data. */
export async function checkOffline(now = Date.now()) {
  const rooms = await query<{ id: string; name: string; last: Date }>(
    `SELECT c.id, c.name, max(r.at) AS last
       FROM cold_rooms c JOIN readings r ON r.room_id = c.id
      WHERE NOT EXISTS (SELECT 1 FROM room_alert_state s WHERE s.room_id = c.id AND s.type = 'offline')
      GROUP BY c.id, c.name`
  );
  for (const room of rooms) {
    if (now - room.last.getTime() < rules.offlineAlertMin * MIN) continue;
    await query("INSERT INTO room_alert_state (room_id, type, since, notified) VALUES ($1, 'offline', $2, true) ON CONFLICT DO NOTHING", [room.id, room.last]);
    await notifyRoom(room.id, 'offline', { room: room.name });
  }
}
