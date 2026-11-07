'use client';

import { Pause, Play, Radio } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { incident as incidentName, temp, time } from '@/lib/format';

import { Badge, Button } from '../ui';

interface Reading {
  at: string;
  chamber: number | null;
  coilOutlet: number | null;
  product: number | null;
  humidity: number | null;
  outside: number | null;
  hotSide: number | null;
  coolerDuty: number | null;
  coolerPower: number | null;
  iceBank: number | null;
  battery: number | null;
  solarCharging: boolean;
  fan: boolean;
  hotFan: boolean;
  pump: boolean;
  compressor: boolean;
  doorOpen: boolean;
  deviceAlerts?: string[];
}

interface Incident {
  id: number;
  type: string;
  started_at: string;
  ended_at: string | null;
}

/** Schematic of the room at one moment: power in, cooler, chamber. Words and values, never color alone. */
function Diagram({ r, peltier, safe }: { r: Reading; peltier: boolean; safe: [number, number] }) {
  const out = r.chamber !== null && (r.chamber < safe[0] || r.chamber > safe[1]);
  const hot = (r.hotSide ?? 0) > 55;
  const coolerOn = peltier ? (r.coolerDuty ?? 0) > 0 : r.pump;
  const node = (x: number, label: string, value: string, sub: string, state: 'on' | 'off' | 'warn') => (
    <g transform={`translate(${x},20)`}>
      <rect
        width="146"
        height="96"
        rx="14"
        fill={state === 'warn' ? 'var(--critical-soft)' : state === 'on' ? 'var(--brand-soft)' : 'var(--surface-2)'}
        stroke={state === 'warn' ? 'var(--critical)' : state === 'on' ? 'var(--brand)' : 'var(--border-strong)'}
        strokeWidth="1.5"
      />
      <text x="14" y="26" fontSize="12" fill="var(--ink-3)">{label}</text>
      <text x="14" y="56" fontSize="22" fontWeight="600" fill="var(--ink)">{value}</text>
      <text x="14" y="80" fontSize="12" fill="var(--ink-2)">{sub}</text>
    </g>
  );
  const link = (x1: number, x2: number, on: boolean, label: string) => (
    <g>
      <line x1={x1} x2={x2} y1="68" y2="68" stroke={on ? 'var(--series-1)' : 'var(--border-strong)'} strokeWidth="2" strokeDasharray={on ? undefined : '4 4'} />
      <polygon points={`${x2},68 ${x2 - 7},63 ${x2 - 7},73`} fill={on ? 'var(--series-1)' : 'var(--border-strong)'} />
      <text x={(x1 + x2) / 2} y="58" fontSize="11" fontWeight="500" textAnchor="middle" fill="var(--ink-2)">{label}</text>
    </g>
  );
  return (
    <svg viewBox="0 0 760 136" className="w-full" role="img" aria-label="Room state diagram">
      {node(0, 'Solar', r.solarCharging ? 'Charging' : 'No sun', r.battery !== null ? `Battery ${r.battery}%` : 'No battery data', r.solarCharging ? 'on' : 'off')}
      {link(146, 204, coolerOn, peltier ? `${r.coolerPower ?? '–'} W` : 'power')}
      {peltier
        ? node(204, 'Peltier cooler', `${r.coolerDuty ?? '–'}%`, `Hot ${temp(r.hotSide)}${r.hotFan ? ' · fan' : ''}`, hot ? 'warn' : coolerOn ? 'on' : 'off')
        : node(204, 'Ice bank', temp(r.iceBank), r.compressor ? 'Making ice' : 'Idle', r.compressor ? 'on' : 'off')}
      {link(350, 408, r.fan, peltier ? temp(r.coilOutlet) : r.pump ? 'water' : 'off')}
      {node(408, 'Chamber', temp(r.chamber), `${r.humidity ?? '–'}% RH${r.doorOpen ? ' · DOOR OPEN' : ''}`, out || r.doorOpen ? 'warn' : 'on')}
      {node(612, 'Inside the crop', temp(r.product), `Outside ${temp(r.outside)}`, 'off')}
    </svg>
  );
}

/**
 * Replay: scrub through the last hours minute by minute and see what the room was doing, with
 * incidents marked on the timeline. "Live" follows the newest reading.
 */
export function TwinReplay({ readings, incidents, peltier, safe, live }: { readings: Reading[]; incidents: Incident[]; peltier: boolean; safe: [number, number]; live?: Reading | null }) {
  const [index, setIndex] = useState(readings.length - 1);
  const [following, setFollowing] = useState(true);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setIndex((i) => {
        if (i >= readings.length - 1) {
          setPlaying(false);
          setFollowing(true);
          return i;
        }
        return i + 1;
      });
    }, 120);
    return () => clearInterval(t);
  }, [playing, readings.length]);

  const start = readings.length ? new Date(readings[0].at).getTime() : 0;
  const end = readings.length ? new Date(readings[readings.length - 1].at).getTime() : 1;
  const marks = useMemo(
    () =>
      incidents
        .filter((i) => (i.ended_at ? new Date(i.ended_at).getTime() : end) >= start && new Date(i.started_at).getTime() <= end)
        .map((i) => ({
          ...i,
          from: Math.max(0, (new Date(i.started_at).getTime() - start) / (end - start || 1)),
          to: Math.min(1, ((i.ended_at ? new Date(i.ended_at).getTime() : end) - start) / (end - start || 1)),
        })),
    [incidents, start, end]
  );

  if (!readings.length) return <p className="p-5 text-sm text-ink-3">No readings in this period.</p>;
  const shown = following ? readings.length - 1 : Math.min(index, readings.length - 1);
  const r = following && live ? live : readings[shown];
  const atLive = following;

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {atLive ? <Badge tone="good" icon={<Radio className="size-3" />}>Live</Badge> : <Badge tone="info">Replay</Badge>}
          <span className="text-sm text-ink-2">{time(r.at)}</span>
          {r.deviceAlerts?.length ? r.deviceAlerts.map((a) => <Badge key={a} tone="critical">{a.replaceAll('_', ' ')}</Badge>) : null}
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            icon={playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            onClick={() => {
              if (!playing) setIndex(following || index >= readings.length - 1 ? 0 : index);
              setFollowing(false);
              setPlaying((p) => !p);
            }}
          >
            {playing ? 'Pause' : 'Play'}
          </Button>
          <Button size="sm" variant={atLive ? 'secondary' : 'primary'} onClick={() => { setPlaying(false); setFollowing(true); }} disabled={atLive}>
            Back to live
          </Button>
        </div>
      </div>

      <Diagram r={r} peltier={peltier} safe={safe} />

      <div>
        <div className="relative h-3">
          {marks.map((m) => (
            <span
              key={m.id}
              title={`${incidentName(m.type)}: ${time(m.started_at)}${m.ended_at ? `–${time(m.ended_at)}` : ', still open'}`}
              className="absolute top-0 h-3 rounded-sm bg-critical/70"
              style={{ left: `${m.from * 100}%`, width: `${Math.max(0.6, (m.to - m.from) * 100)}%` }}
            />
          ))}
        </div>
        <input
          type="range"
          min={0}
          max={readings.length - 1}
          value={atLive ? readings.length - 1 : index}
          onChange={(e) => {
            setPlaying(false);
            setFollowing(false);
            setIndex(Number(e.target.value));
          }}
          className="w-full accent-[var(--brand)]"
          aria-label="Time"
        />
        <div className="flex justify-between text-xs text-ink-3">
          <span>{time(readings[0].at)}</span>
          {marks.length > 0 && <span>Red marks: incidents</span>}
          <span>{time(readings[readings.length - 1].at)}</span>
        </div>
      </div>
    </div>
  );
}
