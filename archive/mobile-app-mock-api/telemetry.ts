import { EXCURSION_GRACE_MINUTES } from './constants';
import type { ColdRoom, ConditionSummary, Reading } from './types';

/**
 * Simulated cold room sensors. Readings are a pure function of room + time so history,
 * live values and certificates always agree. Replace with the ESP32 feed once the backend is live.
 */

export interface Incident {
  roomId: string;
  start: string;
  end: string;
}

const HOUR = 3_600_000;
const MINUTE = 60_000;

function noise(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x) - 0.5; // -0.5 .. 0.5
}

function roomSeed(roomId: string): number {
  let h = 0;
  for (let i = 0; i < roomId.length; i++) h = (h * 31 + roomId.charCodeAt(i)) % 9973;
  return h;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function readingAt(room: ColdRoom, time: number, incidents: Incident[]): Reading {
  const seed = roomSeed(room.id);
  const bucket = Math.floor(time / (5 * MINUTE)) + seed;
  // Kigali is UTC+2 all year.
  const hour = (((time / HOUR + 2) % 24) + 24) % 24;
  const dayWave = Math.sin(((hour - 9) / 24) * 2 * Math.PI);

  const outside = 19 + 6 * dayWave + noise(bucket) * 1.2;
  const sunUp = hour >= 6.5 && hour <= 17.5;
  const cloudy = noise(Math.floor(time / HOUR) + seed * 7) > 0.32;
  const solarCharging = sunUp && !cloudy;

  const battery = clamp(68 + 24 * Math.sin(((hour - 10) / 24) * 2 * Math.PI) + noise(bucket + 3) * 3, 5, 100);

  // Ice is rebuilt while the sun shines and slowly melts overnight.
  const iceBank = -0.6 + 1.6 * clamp(-dayWave, 0, 1) + noise(bucket + 5) * 0.3;
  const compressor = solarCharging && battery > 40;

  // Pump + fan run in ~40 minute cycles to hold the chamber inside the safe band.
  const mid = (room.safeMin + room.safeMax) / 2;
  const cycle = ((time / MINUTE + seed) % 40) / 40;
  const cooling = cycle < 0.45;
  let chamber = mid + (cooling ? 1.1 - cycle * 4 : -0.7 + (cycle - 0.45) * 3.4) + noise(bucket + 9) * 0.3;
  let humidity = 89 + noise(bucket + 11) * 4;

  const inIncident = incidents.some(
    (i) => i.roomId === room.id && time >= Date.parse(i.start) && time <= Date.parse(i.end)
  );
  if (inIncident) {
    chamber = room.safeMax + 2.4 + noise(bucket + 13) * 0.8;
    humidity = 81 + noise(bucket + 15) * 2;
  }

  return {
    at: new Date(time).toISOString(),
    chamber: round1(chamber),
    humidity: Math.round(humidity),
    iceBank: round1(iceBank),
    outside: round1(outside),
    battery: Math.round(battery),
    solarCharging,
    pump: cooling || inIncident,
    fan: cooling || inIncident,
    compressor,
    online: true,
  };
}

export function history(
  room: ColdRoom,
  incidents: Incident[],
  hours: number,
  points: number,
  now = Date.now()
): Reading[] {
  const step = (hours * HOUR) / (points - 1);
  const start = now - hours * HOUR;
  return Array.from({ length: points }, (_, i) => readingAt(room, start + i * step, incidents));
}

export function isInRange(room: ColdRoom, r: Reading): boolean {
  return r.chamber >= room.safeMin && r.chamber <= room.safeMax;
}

/**
 * Summarises cold room conditions between two times. A batch stays "fresh" as long as the
 * chamber never left the safe range for longer than the grace period while it was stored.
 */
export function summarizeConditions(
  room: ColdRoom,
  incidents: Incident[],
  from: number,
  to: number = Date.now()
): ConditionSummary {
  const stepMinutes = 15;
  const step = stepMinutes * MINUTE;
  const start = Math.min(from, to);
  const count = Math.max(1, Math.floor((to - start) / step) + 1);

  let sumT = 0;
  let sumH = 0;
  let minT = Infinity;
  let maxT = -Infinity;
  let run = 0;
  let outMinutes = 0;

  const closeRun = () => {
    const minutes = run * stepMinutes;
    if (minutes >= EXCURSION_GRACE_MINUTES) outMinutes += minutes;
    run = 0;
  };

  for (let i = 0; i < count; i++) {
    const r = readingAt(room, start + i * step, incidents);
    sumT += r.chamber;
    sumH += r.humidity;
    minT = Math.min(minT, r.chamber);
    maxT = Math.max(maxT, r.chamber);
    if (isInRange(room, r)) closeRun();
    else run++;
  }
  closeRun();

  return {
    freshness: outMinutes > 0 ? 'attention' : 'fresh',
    from: new Date(start).toISOString(),
    to: new Date(to).toISOString(),
    hoursStored: Math.max(0, Math.round((to - start) / HOUR)),
    avgTemp: round1(sumT / count),
    minTemp: round1(minT),
    maxTemp: round1(maxT),
    avgHumidity: Math.round(sumH / count),
    minutesOutOfRange: outMinutes,
    samples: count,
  };
}
