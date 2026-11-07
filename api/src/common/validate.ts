import { ApiError } from './api-error.js';

/** Small input checks that fail with the error code the app shows to the user. */

export function body(req: { body: unknown }): Record<string, unknown> {
  return req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
}

export function text(v: unknown, code: string, { min = 1, max = 200 } = {}): string {
  if (typeof v !== 'string' || v.trim().length < min || v.trim().length > max) throw new ApiError(code);
  return v.trim();
}

export function optionalText(v: unknown, max = 500): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

export function positiveInt(v: unknown, code: string, max = 1_000_000): number {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n > max) throw new ApiError(code);
  return Math.round(n);
}

export function oneOf<T extends string>(v: unknown, options: readonly T[], code: string): T {
  if (typeof v !== 'string' || !options.includes(v as T)) throw new ApiError(code);
  return v as T;
}

/** Rwandan mobile numbers to +2507XXXXXXXX. */
export function normalizePhone(input: unknown): string {
  const digits = typeof input === 'string' ? input.replace(/\D/g, '') : '';
  let local = digits;
  if (local.startsWith('250')) local = local.slice(3);
  if (local.startsWith('0')) local = local.slice(1);
  if (!/^7\d{8}$/.test(local)) throw new ApiError('invalidPhone');
  return `+250${local}`;
}

export function pin(v: unknown): string {
  if (typeof v !== 'string' || !/^\d{4}$/.test(v)) throw new ApiError('invalidPin');
  if (/^(\d)\1{3}$/.test(v) || ['1234', '4321', '0123', '9876'].includes(v)) throw new ApiError('pinTooSimple');
  return v;
}

export const CROPS = ['tomato', 'carrot', 'cabbage', 'greenBeans', 'avocado', 'passionFruit', 'pepper', 'spinach', 'eggplant', 'mango'] as const;
export const UNITS = ['kg', 'crate'] as const;
export const BUSINESS_TYPES = ['hotel', 'restaurant', 'wholesaler', 'exporter', 'retailer'] as const;
export const LANGS = ['rw', 'en', 'fr'] as const;
