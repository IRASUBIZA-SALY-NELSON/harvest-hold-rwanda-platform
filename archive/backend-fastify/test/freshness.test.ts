import { describe, expect, it } from 'vitest';

import { summarize, type Sample } from '../src/freshness.js';

const MIN = 60_000;
const c = { safeMin: 0, safeMax: 5, humidityMin: 90, humidityMax: 98, excursionGraceMin: 30, humidityGraceMin: 120 };

/** One reading per minute for `minutes`, with values from fn(minute). */
function series(minutes: number, fn: (m: number) => Partial<Sample> = () => ({})): Sample[] {
  return Array.from({ length: minutes }, (_, m) => ({ at: m * MIN, chamber: 2, humidity: 94, ...fn(m) }));
}

describe('freshness', () => {
  it('is fresh when everything stays in range', () => {
    const s = summarize(series(600), 0, 600 * MIN, c, 5);
    expect(s.freshness).toBe('fresh');
    expect(s.avgTemp).toBe(2);
    expect(s.minutesNoData).toBe(0);
  });

  it('ignores a short warm spell inside the grace period', () => {
    const s = summarize(series(600, (m) => (m >= 100 && m < 125 ? { chamber: 7 } : {})), 0, 600 * MIN, c, 5);
    expect(s.freshness).toBe('fresh');
    expect(s.minutesOutOfRange).toBe(0);
  });

  it('counts a warm spell longer than the grace period', () => {
    const s = summarize(series(600, (m) => (m >= 100 && m < 145 ? { chamber: 7 } : {})), 0, 600 * MIN, c, 5);
    expect(s.freshness).toBe('attention');
    expect(s.minutesOutOfRange).toBe(45);
  });

  it('marks freezing temperatures too', () => {
    const s = summarize(series(600, (m) => (m >= 100 && m < 140 ? { chamber: -1 } : {})), 0, 600 * MIN, c, 5);
    expect(s.freshness).toBe('attention');
  });

  it('counts long dry spells', () => {
    const s = summarize(series(600, (m) => (m >= 100 && m < 250 ? { humidity: 80 } : {})), 0, 600 * MIN, c, 5);
    expect(s.freshness).toBe('attention');
    expect(s.minutesHumidityOutOfRange).toBe(150);
    expect(s.minutesOutOfRange).toBe(0);
  });

  it('is unknown when the data has a long gap', () => {
    const samples = series(600).filter((x) => x.at < 200 * MIN || x.at >= 245 * MIN);
    const s = summarize(samples, 0, 600 * MIN, c, 5);
    expect(s.freshness).toBe('unknown');
    expect(s.longestGapMinutes).toBe(41); // the last reading before the gap covers 5 min
  });

  it('is unknown when there is no data at all', () => {
    const s = summarize([], 0, 120 * MIN, c, 5);
    expect(s.freshness).toBe('unknown');
    expect(s.avgTemp).toBeNull();
    expect(s.minutesNoData).toBe(120);
  });

  it('does not let a gap hide an excursion split in two short parts', () => {
    // 20 min warm, 40 min gap, 20 min warm: neither part passes the grace period, but the gap makes it unknown.
    const samples = series(300, (m) => (m >= 100 && m < 120) || (m >= 160 && m < 180) ? { chamber: 8 } : {}).filter(
      (x) => x.at < 120 * MIN || x.at >= 160 * MIN
    );
    expect(summarize(samples, 0, 300 * MIN, c, 5).freshness).toBe('unknown');
  });

  it('uses the reading taken just before the batch was stored', () => {
    const samples = series(300);
    const s = summarize(samples.filter((x) => x.at <= 100 * MIN || x.at > 102 * MIN), 101.5 * MIN, 300 * MIN, c, 5);
    expect(s.minutesNoData).toBe(0);
  });
});
