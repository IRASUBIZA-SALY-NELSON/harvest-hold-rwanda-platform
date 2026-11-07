import { describe, expect, it } from '@jest/globals';

import en from '../locales/en';
import fr from '../locales/fr';
import rw from '../locales/rw';
import { formatDuration, formatNumber, formatQuantity, formatTemp } from '../format';

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>((acc, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    return typeof v === 'string' ? { ...acc, [key]: v } : { ...acc, ...flatten(v, key) };
  }, {});
}

const placeholders = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort();

describe.each([
  ['rw', rw],
  ['fr', fr],
])('%s translation', (_lang, locale) => {
  const base = flatten(en as unknown as Tree);
  const other = flatten(locale as unknown as Tree);

  it('has exactly the same keys as English', () => {
    expect(Object.keys(other).sort()).toEqual(Object.keys(base).sort());
  });

  it('has no empty strings', () => {
    Object.entries(other).forEach(([key, value]) => expect([key, value.trim().length > 0]).toEqual([key, true]));
  });

  it('keeps the same {{placeholders}}', () => {
    Object.keys(base).forEach((key) => expect([key, placeholders(other[key])]).toEqual([key, placeholders(base[key])]));
  });
});

describe('format helpers', () => {
  const t = ((key: string, opts?: { count?: number }) => `${key}:${opts?.count ?? ''}`) as never;

  it('groups thousands per language', () => {
    expect(formatNumber(14000, 'en')).toBe('14,000');
    expect(formatNumber(1250000, 'rw')).toBe('1,250,000');
    expect(formatNumber(14000, 'fr')).toBe('14 000');
  });

  it('formats temperatures', () => {
    expect(formatTemp(7.25, 'en')).toBe('7.3°C');
    expect(formatTemp(7, 'fr')).toBe('7,0°C');
  });

  it('uses hours under two days, then days', () => {
    expect(formatDuration(5, t)).toBe('time.hours:5');
    expect(formatDuration(0, t)).toBe('time.hours:1');
    expect(formatDuration(72, t)).toBe('time.days:3');
  });

  it('formats quantities with the unit key', () => {
    expect(formatQuantity(3, 'crate', t)).toBe('units.crate:3');
  });
});
