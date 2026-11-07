/** Formatting for the portal. Times are shown in Kigali time (UTC+2). */

const TZ = 'Africa/Kigali';

export const num = (n: number | null | undefined, digits = 0) =>
  n === null || n === undefined || Number.isNaN(n) ? '–' : n.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** 1,284 · 12.9K · 4.2M */
export function compact(n: number | null | undefined) {
  if (n === null || n === undefined) return '–';
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K`;
  return num(n);
}

export const rwf = (n: number | null | undefined) => (n === null || n === undefined ? '–' : `${num(n)} RWF`);
export const rwfCompact = (n: number | null | undefined) => (n === null || n === undefined ? '–' : `${compact(n)} RWF`);
export const temp = (n: number | null | undefined) => (n === null || n === undefined ? '–' : `${n.toFixed(1)}°C`);
export const pct = (n: number | null | undefined, digits = 0) => (n === null || n === undefined ? '–' : `${num(n, digits)}%`);

export function energy(wh: number | null | undefined) {
  if (wh === null || wh === undefined) return '–';
  return wh < 1000 ? `${num(wh)} Wh` : `${num(wh / 1000, 1)} kWh`;
}

export const dateTime = (iso: string | Date | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–';
export const date = (iso: string | Date | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' }) : '–';
export const time = (iso: string | Date | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : '–';
export const shortDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

export function ago(iso: string | Date | null | undefined, now = Date.now()) {
  if (!iso) return 'never';
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

export function duration(min: number | null | undefined) {
  if (min === null || min === undefined) return '–';
  if (min < 60) return `${min} min`;
  if (min < 48 * 60) return `${Math.floor(min / 60)} h ${min % 60 ? `${min % 60} min` : ''}`.trim();
  return `${Math.round(min / 1440)} days`;
}

export const CROP: Record<string, string> = {
  tomato: 'Tomatoes', carrot: 'Carrots', cabbage: 'Cabbage', greenBeans: 'Green beans', avocado: 'Avocados',
  passionFruit: 'Passion fruit', pepper: 'Peppers', spinach: 'Spinach', eggplant: 'Eggplant', mango: 'Mangoes',
};
export const crop = (c: string | null | undefined) => (c ? CROP[c] ?? c : '–');

export const qty = (q: number, unit: string) => `${num(q)} ${unit === 'crate' ? (q === 1 ? 'crate' : 'crates') : unit}`;

/** Names for incident and alert types. */
export const INCIDENT: Record<string, string> = {
  chamberWarm: 'Chamber too warm',
  chamberCold: 'Too cold (freezing risk)',
  humidityLow: 'Air too dry',
  batteryLow: 'Battery low',
  iceLow: 'Ice bank low',
  offline: 'Controller offline',
  coolerOverheat: 'Cooler hot side overheating',
  coolerFault: 'Cooler not working',
  coolingCapacity: 'Cooler can’t keep up',
};
export const incident = (t: string) => INCIDENT[t] ?? t;
