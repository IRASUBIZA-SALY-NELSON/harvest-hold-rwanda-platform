'use client';

import clsx from 'clsx';
import { AlertTriangle, BatteryMedium, CheckCircle2, DoorOpen, FlaskConical, MapPin, Sun, WifiOff, Zap } from 'lucide-react';
import Link from 'next/link';

import { ago, crop, energy, temp } from '@/lib/format';

import { HealthRing, healthLabel, Meter, RangeBar, Sparkline } from '../ui';

export interface RoomCardData {
  id: string;
  name: string;
  district: string;
  sector: string;
  crop: string;
  coolingType: 'peltier' | 'ice_bank';
  status: string;
  storedCrates: number;
  capacityCrates: number;
  farmers?: number;
  openIncidents: number;
  firmwareVersion: number | null;
  energyTodayWh?: number | null;
  lastUploadVia?: 'https' | 'mqtt' | null;
  peltierModules?: number;
  reading: any | null;
  health: { score: number; grade: string; factors: { key: string; label: string; lost: number; detail: string }[] } | null;
  safeMin?: number;
  safeMax?: number;
}

/** One figure in the card's grid: label above, value, optional note in the warning color. */
function Figure({ label, value, warn, children }: { label: string; value: string; warn?: boolean; children?: React.ReactNode }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <div className="truncate text-[11.5px] font-medium text-ink-3">{label}</div>
      <div className={clsx('mt-0.5 truncate text-[15px] font-semibold tabular', warn ? 'text-warning-ink' : 'text-ink')}>{value}</div>
      {children}
    </div>
  );
}

/** One cold room at a glance. `flash` highlights it when a live reading arrives. */
export function RoomCard({ room, trend, flash }: { room: RoomCardData; trend?: number[]; flash?: boolean }) {
  const r = room.reading;
  const online = !!r?.online;
  const hasRange = room.safeMin !== undefined && room.safeMax !== undefined;
  const outOfRange = hasRange && r?.chamber !== null && r?.chamber !== undefined && (r.chamber < room.safeMin! || r.chamber > room.safeMax!);
  const issues = room.health?.factors.filter((f) => f.lost > 0).sort((a, b) => b.lost - a.lost) ?? [];
  const worst = issues[0];
  const peltier = room.coolingType === 'peltier';
  const fill = room.capacityCrates ? room.storedCrates / room.capacityCrates : 0;

  return (
    <Link
      href={`/rooms/${room.id}`}
      className={clsx(
        'group flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card transition-all hover:-translate-y-px hover:border-line-strong hover:shadow-pop',
        flash && 'flash'
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 truncate text-[15px] font-semibold text-ink group-hover:text-brand-ink">
            {room.name}
            <span className="rounded-md bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] font-medium text-ink-2">{room.id}</span>
            {r?.simulated && (
              <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-medium text-warning-ink" title="These readings come from the development simulator, not from a real controller">
                <FlaskConical className="size-3" /> Simulated
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-1 truncate text-[13px] text-ink-3">
            <MapPin className="size-3 shrink-0" />
            {room.sector}, {room.district} · {crop(room.crop)} · {peltier ? 'Peltier' : 'Ice bank'}
          </div>
        </div>
        {room.status !== 'active' ? (
          <span className="shrink-0 rounded-full bg-warning-soft px-2.5 py-1 text-xs font-medium text-warning-ink capitalize">{room.status}</span>
        ) : online ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-good-soft px-2.5 py-1 text-xs font-medium text-good-ink">
            <span className="live-dot size-1.5 rounded-full bg-good" aria-hidden />
            Live · {ago(r.at)}
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-critical-soft px-2.5 py-1 text-xs font-medium text-critical-ink">
            <WifiOff className="size-3" />
            {r ? `Offline · ${ago(r.at)}` : 'Never reported'}
          </span>
        )}
      </div>

      {/* Chamber temperature against its safe range, and the health score */}
      <div className="flex items-start gap-4 px-5 pt-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className={clsx('text-[34px] font-semibold leading-none tracking-tight tabular', outOfRange ? 'text-warning-ink' : 'text-ink')}>{temp(r?.chamber)}</span>
            <span className="text-[13px] text-ink-3">chamber</span>
            {r?.doorOpen && (
              <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-medium text-warning-ink">
                <DoorOpen className="size-3" /> Door open
              </span>
            )}
          </div>
          <div className="mt-3">{hasRange && <RangeBar value={r?.chamber} min={room.safeMin!} max={room.safeMax!} />}</div>
        </div>
        <div className="flex shrink-0 flex-col items-center">
          <HealthRing score={room.health?.score} size={52} />
          <span className="mt-1 text-[11px] font-medium text-ink-3">Health · {healthLabel(room.health?.score)}</span>
        </div>
      </div>

      {/* 24 h trend */}
      <div className="px-5 pt-2">
        <div className="mb-1 flex justify-between text-[11px] text-ink-3">
          <span>Last 24 hours</span>
          {trend && trend.length > 1 && (
            <span className="tabular">
              {temp(Math.min(...trend))} – {temp(Math.max(...trend))}
            </span>
          )}
        </div>
        {trend && trend.length > 1 ? <Sparkline values={trend} band={hasRange ? [room.safeMin!, room.safeMax!] : undefined} height={40} fluid /> : <div className="h-10 rounded-md bg-surface-2" />}
      </div>

      {/* Key figures */}
      <div className="mt-4 grid grid-cols-4 divide-x divide-line border-y border-line bg-surface-2">
        <Figure label="Humidity" value={r?.humidity === null || r?.humidity === undefined ? '–' : `${Math.round(r.humidity)}%`} />
        {peltier ? (
          <>
            <Figure label="Cooler" value={r?.coolerDuty === null || r?.coolerDuty === undefined ? '–' : `${r.coolerDuty}%${r.coolerPower ? ` · ${r.coolerPower} W` : ''}`} warn={(r?.coolerDuty ?? 0) > 90} />
            <Figure label="Hot side" value={temp(r?.hotSide)} warn={(r?.hotSide ?? 0) > 55} />
          </>
        ) : (
          <>
            <Figure label="Ice bank" value={temp(r?.iceBank)} warn={(r?.iceBank ?? -10) > 2} />
            <Figure label="Battery" value={r?.battery === null || r?.battery === undefined ? '–' : `${r.battery}%`} warn={(r?.battery ?? 100) < 25} />
          </>
        )}
        <Figure label="Stored, crates" value={`${room.storedCrates} / ${room.capacityCrates}`} warn={fill > 1}>
          <div className="mt-1.5">
            <Meter value={room.storedCrates} max={room.capacityCrates} tone={fill > 0.95 ? 'critical' : fill > 0.8 ? 'warning' : 'brand'} />
          </div>
        </Figure>
      </div>

      {/* Power, battery and solar: where installed */}
      <div className="grid grid-cols-4 divide-x divide-line border-b border-line">
        <Figure label="Power now" value={r?.coolerPower === null || r?.coolerPower === undefined ? '–' : `${r.coolerPower} W`} />
        <Figure label="Energy today" value={energy(room.energyTodayWh)} />
        <Figure
          label="Battery"
          value={r?.battery === null || r?.battery === undefined ? '–' : `${r.battery}%${r.batteryV ? ` · ${r.batteryV} V` : ''}`}
          warn={(r?.battery ?? 100) < 25}
        />
        <Figure
          label="Solar"
          value={r?.solarPower ? `${r.solarPower} W` : r?.solarV === null || r?.solarV === undefined ? '–' : r.solarCharging ? `charging · ${r.solarV} V` : `${r.solarV} V`}
        />
      </div>
      <div className="flex items-center gap-3 border-b border-line px-5 py-2 text-[11.5px] text-ink-3">
        <span className="inline-flex items-center gap-1"><Zap className="size-3" /> {room.peltierModules ?? 1} Peltier module{(room.peltierModules ?? 1) === 1 ? '' : 's'}</span>
        <span className="inline-flex items-center gap-1"><BatteryMedium className="size-3" /> fans: {r?.hotFan ? 'hot side on' : 'hot side off'}, {r?.fan ? 'inside on' : 'inside off'}</span>
        <span className="ml-auto inline-flex items-center gap-1"><Sun className="size-3" /> link: {room.lastUploadVia === 'mqtt' ? 'MQTT (backup)' : 'HTTPS'}</span>
      </div>

      {/* What the health score is about */}
      <div className="mt-auto flex items-start gap-2 px-5 py-3 text-[13px]">
        {room.openIncidents > 0 ? (
          <>
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-critical" />
            <span className="text-critical-ink">
              {room.openIncidents} open incident{room.openIncidents > 1 ? 's' : ''}
              {worst ? <span className="text-ink-2"> · {worst.detail}</span> : null}
            </span>
          </>
        ) : worst ? (
          <>
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            <span className="text-ink-2">
              <span className="font-medium text-ink">{worst.label}:</span> {worst.detail}
              {issues.length > 1 && <span className="text-ink-3"> · +{issues.length - 1} more</span>}
            </span>
          </>
        ) : (
          <>
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-good" />
            <span className="text-ink-2">All checks passed in the last 24 hours</span>
          </>
        )}
      </div>
    </Link>
  );
}
