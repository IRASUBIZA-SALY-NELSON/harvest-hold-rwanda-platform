'use client';

import clsx from 'clsx';
import { Activity, AlertTriangle, Award, Boxes, CheckCircle2, Download, ShieldCheck, ShoppingBasket, Siren, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { useMe } from '@/components/admin-context';
import { RoomCard, type RoomCardData } from '@/components/domain/room-card';
import { Badge, Card, CardHeader, EmptyState, ErrorBox, LinkButton, PageHeader, Skeleton, StatTile } from '@/components/ui';
import { api, useQuery } from '@/lib/api';
import { ago, compact, energy, incident, num, rwfCompact, time } from '@/lib/format';
import { type LiveEvent, useLiveEvents } from '@/lib/live';

interface Overview {
  generatedAt: string;
  kpis: Record<string, any>;
  rooms: RoomCardData[];
  openIncidents: { id: number; roomId: string; roomName: string; type: string; startedAt: string; acknowledgedAt: string | null }[];
}

function describe(e: LiveEvent): { text: string; tone: 'neutral' | 'good' | 'warning' | 'critical' | 'info'; href?: string } | null {
  switch (e.type) {
    case 'incident':
      return { text: `${incident(e.incidentType)} ${e.state === 'open' ? 'started' : 'resolved'}`, tone: e.state === 'open' ? 'critical' : 'good', href: `/rooms/${e.roomId}` };
    case 'order':
      return { text: `Order ${e.orderId} ${e.status}`, tone: 'info', href: `/market?order=${e.orderId}` };
    case 'audit':
      return { text: `${e.actor}: ${e.summary}`, tone: 'neutral', href: '/audit' };
    case 'command':
      return { text: `Command ${e.commandId} ${e.status}`, tone: e.status === 'failed' ? 'critical' : 'info', href: `/rooms/${e.roomId}` };
    case 'alert':
      return null; // alerts mirror incidents and orders already shown
    default:
      return null;
  }
}

const KIGALI = 'Africa/Kigali';
const plural = (n: number | string, word: string) => `${num(Number(n))} ${word}${Number(n) === 1 ? '' : 's'}`;
const kigaliDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { timeZone: KIGALI, weekday: 'long', day: 'numeric', month: 'long' });
function greeting(iso: string) {
  const h = Number(new Date(iso).toLocaleString('en-GB', { timeZone: KIGALI, hour: '2-digit', hour12: false }));
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/**
 * The state of the whole network in one sentence, with the reasons as chips. Says which rooms
 * need attention, so staff know where to look first.
 */
function StatusBanner({ rooms, incidents, kpis }: { rooms: RoomCardData[]; incidents: number; kpis: Record<string, any> }) {
  const active = rooms.filter((r) => r.status === 'active');
  const offline = active.filter((r) => !r.reading?.online);
  const outOfRange = active.filter(
    (r) => r.reading?.online && r.safeMin !== undefined && r.reading.chamber !== null && (r.reading.chamber < r.safeMin || r.reading.chamber > r.safeMax!)
  );
  const lowHealth = active.filter((r) => (r.health?.score ?? 100) < 60);
  const attention = new Set([...offline, ...outOfRange, ...lowHealth].map((r) => r.name));
  if (incidents) rooms.filter((r) => r.openIncidents > 0).forEach((r) => attention.add(r.name));
  const level: 'good' | 'warning' | 'critical' = incidents || offline.length ? 'critical' : attention.size ? 'warning' : 'good';
  const headline =
    level === 'good'
      ? 'Everything is running well'
      : `${attention.size} room${attention.size === 1 ? ' needs' : 's need'} attention: ${[...attention].join(', ')}`;

  const chips: { text: string; ok: boolean }[] = [
    { text: `${active.length - offline.length} of ${active.length} rooms reporting live`, ok: !offline.length },
    { text: outOfRange.length ? `${outOfRange.length} chamber${outOfRange.length > 1 ? 's' : ''} outside the safe range` : 'Every chamber in its safe range', ok: !outOfRange.length },
    { text: incidents ? `${incidents} open incident${incidents > 1 ? 's' : ''}` : 'No open incidents', ok: !incidents },
  ];

  const Icon = level === 'good' ? ShieldCheck : level === 'warning' ? AlertTriangle : Siren;
  return (
    <div
      className={clsx(
        'relative mb-5 overflow-hidden rounded-2xl border p-5 shadow-card',
        level === 'good' ? 'border-brand/20 bg-brand-soft' : level === 'warning' ? 'border-warning/40 bg-warning-soft' : 'border-critical/30 bg-critical-soft'
      )}
    >
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-4">
          <span
            className={clsx(
              'flex size-12 shrink-0 items-center justify-center rounded-2xl text-white shadow-sm',
              level === 'good' ? 'bg-brand' : level === 'warning' ? 'bg-warning' : 'bg-critical'
            )}
          >
            <Icon className="size-6" />
          </span>
          <div className="min-w-0">
            <div className={clsx('text-lg font-semibold tracking-tight', level === 'good' ? 'text-brand-ink' : level === 'warning' ? 'text-warning-ink' : 'text-critical-ink')}>{headline}</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {chips.map((c) => (
                <span key={c.text} className="inline-flex items-center gap-1.5 rounded-full bg-surface/70 px-2.5 py-1 text-xs font-medium text-ink-2">
                  {c.ok ? <CheckCircle2 className="size-3.5 text-good" /> : <AlertTriangle className="size-3.5 text-critical" />}
                  {c.text}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="grid shrink-0 grid-cols-3 divide-x divide-line overflow-hidden rounded-xl border border-line bg-surface">
          <BannerFigure label="Average health" value={kpis.avgHealth ?? '–'} sub="out of 100" />
          <BannerFigure label="Cooler energy" value={energy(kpis.energyTodayWh)} sub="today, all rooms" />
          {kpis.farmers === undefined ? (
            <BannerFigure label="To collect" value={num(Number(kpis.toCollect ?? 0))} sub="batches asked for" />
          ) : (
            <BannerFigure label="People" value={num(Number(kpis.farmers) + Number(kpis.buyers))} sub={`${plural(kpis.farmers, 'farmer')} · ${plural(kpis.buyers, 'buyer')}`} />
          )}
        </div>
      </div>
    </div>
  );
}

function BannerFigure({ label, value, sub }: { label: string; value: React.ReactNode; sub: string }) {
  return (
    <div className="min-w-0 px-4 py-3 sm:min-w-[132px]">
      <div className="truncate text-[11.5px] font-medium text-ink-3">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tracking-tight text-ink tabular">{value}</div>
      <div className="truncate text-[11.5px] text-ink-3">{sub}</div>
    </div>
  );
}

/** Certificate results as one stacked bar, with the counts written next to it. */
function CertificateMix({ fresh, attention, unknown }: { fresh: number; attention: number; unknown: number }) {
  const total = fresh + attention + unknown;
  const parts = [
    { n: fresh, label: 'fresh', color: 'var(--good)' },
    { n: attention, label: 'check', color: 'var(--serious)' },
    { n: unknown, label: 'no data', color: 'var(--ink-3)' },
  ];
  return (
    <div>
      <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
        {total > 0 && parts.filter((p) => p.n).map((p) => <div key={p.label} style={{ width: `${(p.n / total) * 100}%`, background: p.color }} />)}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-ink-3">
        {parts.map((p) => (
          <span key={p.label} className="inline-flex items-center gap-1">
            <span className="size-1.5 rounded-full" style={{ background: p.color }} aria-hidden />
            {p.n} {p.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function OverviewPage() {
  const me = useMe();
  const overview = useQuery<Overview>('overview', { refreshMs: 60_000 });
  const [trends, setTrends] = useState<Record<string, number[]>>({});
  const [flash, setFlash] = useState<Record<string, boolean>>({});
  const [feed, setFeed] = useState<{ at: number; e: LiveEvent }[]>([]);

  // 24 h trend per room for the sparklines.
  const roomIds = overview.data?.rooms.map((r) => r.id).join(',');
  useEffect(() => {
    if (!roomIds) return;
    for (const id of roomIds.split(',')) {
      api<any[]>(`rooms/${id}/history?range=24h`)
        .then((h) => setTrends((t) => ({ ...t, [id]: h.map((r) => r.chamber).filter((v) => v !== null) })))
        .catch(() => {});
    }
  }, [roomIds]);

  useLiveEvents((e) => {
    if (e.type === 'reading') {
      overview.setData((d) => d && { ...d, rooms: d.rooms.map((r) => (r.id === e.roomId ? { ...r, reading: e.reading } : r)) });
      setFlash((f) => ({ ...f, [e.roomId]: true }));
      setTimeout(() => setFlash((f) => ({ ...f, [e.roomId]: false })), 1600);
      if (e.reading.chamber !== null) setTrends((t) => ({ ...t, [e.roomId]: [...(t[e.roomId] ?? []).slice(-60), e.reading.chamber] }));
      return;
    }
    if (e.type === 'incident') void overview.reload();
    if (describe(e)) setFeed((f) => [{ at: Date.now(), e }, ...f].slice(0, 40));
  });

  if (overview.error) return <ErrorBox error={overview.error} onRetry={overview.reload} />;
  const d = overview.data;
  const k = d?.kpis;
  const gmvDelta = k && Number(k.gmvPrev30d) ? Math.round(((k.gmv30d - k.gmvPrev30d) / k.gmvPrev30d) * 100) : null;
  const certs = (k?.certificates30d ?? {}) as Record<string, number>;
  const certTotal = Object.values(certs).reduce((a, b) => a + Number(b), 0);
  const rooms = d?.rooms.filter((r) => r.status !== 'retired') ?? [];

  return (
    <>
      <PageHeader
        eyebrow={d ? kigaliDate(d.generatedAt) : undefined}
        title={d ? `${greeting(d.generatedAt)}, ${me.name.split(' ')[0]}` : 'Overview'}
        subtitle={me.role === 'operator' ? 'The cold rooms you look after, live.' : 'Every cold room, live, with the people and the market around them.'}
        actions={
          <>
            <span className="text-[13px] text-ink-3">{d ? `Updated ${time(d.generatedAt)}` : ''}</span>
            <LinkButton href={me.role === 'operator' ? '/energy' : '/analytics'} icon={<Activity className="size-4" />}>
              {me.role === 'operator' ? 'Energy' : 'Analytics'}
            </LinkButton>
          </>
        }
      />

      {!d || !k ? <Skeleton className="mb-5 h-[132px] rounded-2xl" /> : <StatusBanner rooms={rooms} incidents={d.openIncidents.length} kpis={k} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {!k
          ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[132px] rounded-2xl" />)
          : (
            <>
              <StatTile
                label="In storage now"
                value={`${compact(k.storedKg)} kg`}
                sub={`+ ${num(k.storedCrates)} crates · ${num(k.storedBatches)} batches`}
                icon={<Boxes className="size-4" />}
                href="/stock"
              />
              {k.gmv30d !== undefined && <StatTile
                label="Sales, last 30 days"
                value={rwfCompact(k.gmv30d)}
                sub={
                  gmvDelta === null ? (
                    'accepted orders'
                  ) : (
                    <span className={gmvDelta >= 0 ? 'text-good-ink' : 'text-critical-ink'}>
                      {gmvDelta >= 0 ? '▲' : '▼'} {Math.abs(gmvDelta)}% vs the 30 days before
                    </span>
                  )
                }
                icon={<TrendingUp className="size-4" />}
                href="/market"
              />}
              {k.ordersPending !== undefined && <StatTile
                label="Orders waiting"
                value={num(k.ordersPending)}
                sub={`${num(k.ordersToday)} placed today · ${num(k.activeListings)} listings on sale`}
                tone={k.ordersPending > 0 ? 'warning' : undefined}
                icon={<ShoppingBasket className="size-4" />}
                href="/market"
              />}
              {k.certificates30d !== undefined && <StatTile
                label="Certificates, last 30 days"
                value={num(certTotal)}
                icon={<Award className="size-4" />}
                href="/certificates"
                footer={<CertificateMix fresh={Number(certs.fresh ?? 0)} attention={Number(certs.attention ?? 0)} unknown={Number(certs.unknown ?? 0)} />}
              />}
              {k.gmv30d === undefined && (
                <StatTile label="Cooler energy today" value={energy(k.energyTodayWh)} sub="your rooms" icon={<Activity className="size-4" />} href="/energy" />
              )}
            </>
          )}
      </div>

      <div className="mt-7">
        <div>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-[15px] font-semibold text-ink">Cold rooms</h2>
            <Link href="/rooms" className="text-[13px] font-medium text-brand-ink hover:underline">
              All rooms
            </Link>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {!d && Array.from({ length: 2 }, (_, i) => <Skeleton key={i} className="h-[380px] rounded-2xl" />)}
            {rooms.map((r) => (
              <RoomCard key={r.id} room={r} trend={trends[r.id]} flash={!!flash[r.id]} />
            ))}
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2 xl:grid-cols-[1fr_1fr_300px]">
          <Card>
            <CardHeader title="Open incidents" actions={<Link href="/incidents" className="text-[13px] font-medium text-brand-ink hover:underline">All</Link>} />
            {!d ? (
              <div className="p-4"><Skeleton className="h-16" /></div>
            ) : d.openIncidents.length ? (
              <ul className="divide-y divide-line">
                {d.openIncidents.map((i) => (
                  <li key={i.id} className="px-5 py-3">
                    <Link href={`/rooms/${i.roomId}`} className="block">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-ink">{incident(i.type)}</span>
                        {i.acknowledgedAt ? <Badge tone="info">Handled</Badge> : <Badge tone="critical">New</Badge>}
                      </div>
                      <div className="text-[13px] text-ink-3">
                        {i.roomName} · since {ago(i.startedAt)}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="All clear" body="No room has an open problem." />
            )}
          </Card>

          <Card>
            <CardHeader title="Live activity" subtitle="As it happens, from every room and user" />
            {feed.length ? (
              <ul className="thin-scroll max-h-[320px] divide-y divide-line overflow-y-auto">
                {feed.map(({ at, e }, idx) => {
                  const x = describe(e)!;
                  return (
                    <li key={`${at}-${idx}`} className="flex gap-3 px-5 py-2.5">
                      <span className="mt-1.5 inline-block size-2 shrink-0 rounded-full" style={{ background: x.tone === 'critical' ? 'var(--critical)' : x.tone === 'good' ? 'var(--good)' : x.tone === 'info' ? 'var(--series-1)' : 'var(--ink-3)' }} aria-hidden />
                      <div className="min-w-0 flex-1">
                        {x.href ? <Link href={x.href} className="text-sm text-ink hover:underline">{x.text}</Link> : <span className="text-sm text-ink">{x.text}</span>}
                        <div className="text-xs text-ink-3">{time(new Date(at))}</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState title="Waiting for activity" body="New orders, incidents and staff actions appear here the moment they happen." />
            )}
          </Card>

          {me.role !== 'operator' && <Card className="p-5 lg:col-span-2 xl:col-span-1">
            <div className="text-[15px] font-semibold text-ink">Exports</div>
            <p className="mt-0.5 text-[13px] text-ink-3">Last 90 days, as spreadsheets (CSV)</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {['users', 'orders', 'certificates', 'inventory', 'collections', 'energy'].map((x) => (
                <a key={x} href={`/api/admin/export/${x}.csv?days=90`} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[13px] text-ink-2 hover:bg-surface-3">
                  <Download className="size-3.5" />
                  {x}.csv
                </a>
              ))}
            </div>
          </Card>}
        </div>
      </div>
    </>
  );
}
