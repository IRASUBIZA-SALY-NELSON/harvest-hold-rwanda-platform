import type { RoomConditions } from './crops.js';

/**
 * Freshness from real readings.
 *
 * - Each reading covers the time until the next one, but never more than `maxGapMin`.
 *   Time not covered by any reading is "no data".
 * - Temperature outside the safe range only counts once it lasts `excursionGraceMin`.
 * - Humidity outside its range only counts once it lasts `humidityGraceMin`.
 * - Result: "attention" if either counted; otherwise "unknown" if there is a single gap in
 *   the data at least as long as the temperature grace period; otherwise "fresh".
 */

export type Freshness = 'fresh' | 'attention' | 'unknown';

export interface Sample {
  at: number; // ms
  chamber: number | null;
  humidity: number | null;
}

export interface ConditionSummary {
  freshness: Freshness;
  from: string;
  to: string;
  hoursStored: number;
  avgTemp: number | null;
  minTemp: number | null;
  maxTemp: number | null;
  avgHumidity: number | null;
  minutesOutOfRange: number;
  minutesHumidityOutOfRange: number;
  minutesNoData: number;
  longestGapMinutes: number;
  samples: number;
  safeMin: number;
  safeMax: number;
  humidityMin: number;
  humidityMax: number;
}

const MIN = 60_000;
const round1 = (n: number) => Math.round(n * 10) / 10;

class RunCounter {
  private runStart: number | null = null;
  private runEnd = 0;
  total = 0;
  constructor(private graceMs: number) {}
  /** An interval [start, end) that is either bad or not. Runs break on good intervals and gaps. */
  add(start: number, end: number, bad: boolean) {
    if (bad && this.runStart !== null && start === this.runEnd) {
      this.runEnd = end;
      return;
    }
    this.close();
    if (bad) {
      this.runStart = start;
      this.runEnd = end;
    }
  }
  close() {
    if (this.runStart !== null && this.runEnd - this.runStart >= this.graceMs) this.total += this.runEnd - this.runStart;
    this.runStart = null;
  }
}

/** `samples` sorted by time; may include readings from before `from`. */
export function summarize(samples: Sample[], from: number, to: number, c: RoomConditions, maxGapMin: number): ConditionSummary {
  const maxGap = maxGapMin * MIN;
  const temp = new RunCounter(c.excursionGraceMin * MIN);
  const hum = new RunCounter(c.humidityGraceMin * MIN);
  let noData = 0;
  let longestGap = 0;
  let cursor = from; // everything before cursor is accounted for

  let sumT = 0, nT = 0, minT = Infinity, maxT = -Infinity, sumH = 0, nH = 0, count = 0;

  const gap = (start: number, end: number) => {
    if (end <= start) return;
    noData += end - start;
    longestGap = Math.max(longestGap, end - start);
    temp.close();
    hum.close();
  };

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const next = i + 1 < samples.length ? samples[i + 1].at : Infinity;
    const start = Math.max(s.at, from);
    const end = Math.min(next, s.at + maxGap, to);
    if (end <= start) continue;

    gap(cursor, start);
    if (s.at >= from) {
      count++;
      if (s.chamber !== null) {
        sumT += s.chamber; nT++;
        minT = Math.min(minT, s.chamber);
        maxT = Math.max(maxT, s.chamber);
      }
      if (s.humidity !== null) { sumH += s.humidity; nH++; }
    }

    if (s.chamber === null) gap(start, end);
    else temp.add(start, end, s.chamber < c.safeMin || s.chamber > c.safeMax);
    if (s.humidity !== null) hum.add(start, end, s.humidity < c.humidityMin || s.humidity > c.humidityMax);
    else hum.close();
    cursor = Math.max(cursor, end);
  }
  gap(cursor, to);
  temp.close();
  hum.close();

  const minutesOutOfRange = Math.round(temp.total / MIN);
  const minutesHumidityOutOfRange = Math.round(hum.total / MIN);
  const freshness: Freshness =
    minutesOutOfRange > 0 || minutesHumidityOutOfRange > 0 ? 'attention'
    : longestGap >= c.excursionGraceMin * MIN ? 'unknown'
    : 'fresh';

  return {
    freshness,
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    hoursStored: Math.max(0, Math.round((to - from) / 3_600_000)),
    avgTemp: nT ? round1(sumT / nT) : null,
    minTemp: nT ? round1(minT) : null,
    maxTemp: nT ? round1(maxT) : null,
    avgHumidity: nH ? Math.round(sumH / nH) : null,
    minutesOutOfRange,
    minutesHumidityOutOfRange,
    minutesNoData: Math.round(noData / MIN),
    longestGapMinutes: Math.round(longestGap / MIN),
    samples: count,
    safeMin: c.safeMin,
    safeMax: c.safeMax,
    humidityMin: c.humidityMin,
    humidityMax: c.humidityMax,
  };
}
