import type { TFunction } from 'i18next';

import type { Unit } from '@/api/types';

// Month names are kept here instead of relying on Intl, which is incomplete for Kinyarwanda on Hermes.
const MONTHS: Record<string, string[]> = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  fr: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'],
  rw: ['Mut.', 'Gas.', 'Wer.', 'Mata', 'Gic.', 'Kam.', 'Nya.', 'Kan.', 'Nze.', 'Ukw.', 'Ugu.', 'Uku.'],
};

const pad = (n: number) => String(n).padStart(2, '0');

export function formatDate(iso: string, lang: string): string {
  const d = new Date(iso);
  const months = MONTHS[lang] ?? MONTHS.en;
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatDateTime(iso: string, lang: string): string {
  return `${formatDate(iso, lang)}, ${formatTime(iso)}`;
}

/** 14000 -> "14,000" (fr: "14 000"). */
export function formatNumber(n: number, lang: string): string {
  const sep = lang === 'fr' ? ' ' : ',';
  const [int, dec] = Math.abs(n).toString().split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  return `${n < 0 ? '-' : ''}${grouped}${dec ? (lang === 'fr' ? ',' : '.') + dec : ''}`;
}

export function formatMoney(n: number, t: TFunction, lang: string): string {
  return t('common.rwf', { amount: formatNumber(n, lang) });
}

export function formatQuantity(quantity: number, unit: Unit, t: TFunction): string {
  return t(`units.${unit}`, { count: quantity });
}

export function unitName(unit: Unit, t: TFunction): string {
  return t(unit === 'crate' ? 'units.crateName' : 'units.kgName');
}

export function formatRelative(iso: string, t: TFunction, now = Date.now()): string {
  const minutes = Math.round((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return t('time.justNow');
  if (minutes < 60) return t('time.minutesAgo', { count: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('time.hoursAgo', { count: hours });
  return t('time.daysAgo', { count: Math.round(hours / 24) });
}

export function formatDuration(hours: number, t: TFunction): string {
  if (hours < 48) return t('time.hours', { count: Math.max(1, hours) });
  return t('time.days', { count: Math.floor(hours / 24) });
}

/** "–" when the sensor did not report. */
export function formatTemp(n: number | null | undefined, lang: string): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  const s = n.toFixed(1);
  return `${lang === 'fr' ? s.replace('.', ',') : s}°C`;
}
