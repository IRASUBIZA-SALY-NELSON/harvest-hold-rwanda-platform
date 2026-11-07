'use client';

import { CheckCircle2, Download, FlaskConical, KeyRound, Lightbulb, MapPin, Power, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { use, useEffect, useState } from 'react';

import { useCan } from '@/components/admin-context';
import { ChartCard, Columns, TimeLines } from '@/components/charts';
import { TwinReplay } from '@/components/domain/twin';
import {
  ActionDialog,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorBox,
  Field,
  FreshnessBadge,
  HealthRing,
  healthLabel,
  Input,
  Modal,
  PageHeader,
  SecretBox,
  Segmented,
  Select,
  Skeleton,
  StatTile,
  Table,
  Tabs,
  Td,
  Textarea,
  Th,
  useToast,
} from '@/components/ui';
import { api, useQuery } from '@/lib/api';
import { DISTRICTS } from '@/lib/districts';
import { errorMessage } from '@/lib/errors';
import { ago, crop, dateTime, duration, energy, incident, num, qty, temp, time } from '@/lib/format';
import { useLiveEvents } from '@/lib/live';

type Tab = 'live' | 'control' | 'history' | 'stock' | 'timeline' | 'settings';

export default function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const can = useCan();
  const detail = useQuery<any>(`rooms/${id}`, { refreshMs: 60_000 });
  const [tab, setTab] = useState<Tab>('live');
  const [live, setLive] = useState<any>(null);

  useLiveEvents((e) => {
    if (e.type === 'reading' && e.roomId === id) setLive(e.reading);
    if ((e.type === 'incident' || e.type === 'command') && e.roomId === id) void detail.reload();
  });

  if (detail.error) return <ErrorBox error={detail.error} onRetry={detail.reload} />;
  const d = detail.data;
  if (!d) return <Skeleton className="h-96 rounded-xl" />;
  const room = d.room;
  const reading = live ?? d.reading;
  const peltier = room.coolingType === 'peltier';
  const openIncidents = d.incidents.filter((i: any) => !i.ended_at);

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/rooms" className="hover:underline">Cold rooms</Link>}
        title={
          <span className="flex items-center gap-3">
            {room.name}
            {room.status !== 'active' ? <Badge tone="warning">{room.status}</Badge> : reading?.online ? <Badge tone="good">Online</Badge> : <Badge tone="critical">Offline</Badge>}
          </span>
        }
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{room.sector}, {room.district}</span>
            <span className="font-mono">{room.id}</span>
            <span>{crop(room.crop)} · {peltier ? `Peltier, ${room.peltierModules} module${room.peltierModules === 1 ? '' : 's'}` : 'Ice bank'}</span>
            {reading?.simulated && <Badge tone="warning" icon={<FlaskConical className="size-3" />}>Simulated data</Badge>}
            <span>Link: {room.lastUploadVia === 'mqtt' ? 'MQTT (backup)' : 'HTTPS'}{d.mqtt.connected ? ' · MQTT connected' : ''}</span>
            <span>Controller v{room.firmwareVersion ?? '?'} ({room.firmwareChannel}) · last seen {ago(room.lastUploadAt)}</span>
          </span>
        }
        actions={
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-xs text-ink-3">Health</div>
              <div className="text-sm font-medium">{healthLabel(d.health?.score)}</div>
            </div>
            <HealthRing score={d.health?.score} size={52} />
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <StatTile label="Chamber" value={temp(reading?.chamber)} sub={`safe ${d.view.safeMin}–${d.view.safeMax}°C`} tone={reading && reading.chamber !== null && (reading.chamber < d.view.safeMin || reading.chamber > d.view.safeMax) ? 'warning' : undefined} />
        <StatTile label="Humidity" value={reading?.humidity === null || !reading ? '–' : `${reading.humidity}%`} sub={`safe ${d.view.humidityMin}–${d.view.humidityMax}%`} />
        {peltier ? (
          <>
            <StatTile label="Cooler power" value={`${reading?.coolerDuty ?? '–'}%`} sub={reading?.coolerPower !== null && reading?.coolerPower !== undefined ? `${reading.coolerPower} W now` : 'no power meter'} />
            <StatTile label="Hot side" value={temp(reading?.hotSide)} sub="reduced above 55°C" tone={(reading?.hotSide ?? 0) > 55 ? 'critical' : undefined} />
          </>
        ) : (
          <>
            <StatTile label="Ice bank" value={temp(reading?.iceBank)} sub={reading?.compressor ? 'making ice' : 'idle'} />
            <StatTile label="Battery" value={reading?.battery === null || !reading ? '–' : `${reading.battery}%`} sub={reading?.solarCharging ? 'charging' : 'on battery'} />
          </>
        )}
        <StatTile label="Energy today" value={energy(d.energyTodayWh)} sub="cooler, since midnight" />
        {peltier && <StatTile label="Battery" value={reading?.battery === null || reading?.battery === undefined ? '–' : `${reading.battery}%`} sub={reading?.batteryV ? `${reading.batteryV} V · ${reading.solarCharging ? 'charging' : 'on battery'}` : 'not installed'} tone={(reading?.battery ?? 100) < 25 ? 'warning' : undefined} />}
        <StatTile label="Solar" value={reading?.solarPower ? `${reading.solarPower} W` : reading?.solarV === null || reading?.solarV === undefined ? '–' : `${reading.solarV} V`} sub={reading?.solarPower ? 'generating now' : reading?.solarV !== null && reading?.solarV !== undefined ? (reading.solarCharging ? 'panel charging' : 'panel idle') : 'not installed'} />
        <StatTile label="Fans" value={`${reading?.hotFan ? 'Hot side on' : 'Hot side off'}`} sub={peltier ? `inside fan ${reading?.fan ? 'on' : 'off'}${reading?.humidifier ? ' · humidifier on' : ''}` : `pump ${reading?.pump ? 'on' : 'off'}`} />
        <StatTile label="Stored" value={`${num(d.batches.length)} batches`} sub={`${d.farmers.length} farmers · ${d.certificates30d} certificates / 30 d`} />
      </div>

      {openIncidents.length > 0 && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-critical/30 bg-critical-soft px-4 py-3 text-sm text-critical-ink">
          <ShieldAlert className="size-4 shrink-0" />
          <span className="flex-1">{openIncidents.map((i: any) => `${incident(i.type)} since ${ago(i.started_at)}`).join(' · ')}</span>
          <Button size="sm" onClick={() => setTab('timeline')}>Handle</Button>
        </div>
      )}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'live', label: 'Live & replay' },
          { value: 'control', label: 'Remote control', count: d.commands.filter((c: any) => c.status === 'pending' || c.status === 'sent').length || undefined },
          { value: 'history', label: 'History' },
          { value: 'stock', label: 'Stock & farmers', count: d.batches.length },
          { value: 'timeline', label: 'Incidents & timeline', count: openIncidents.length || undefined },
          ...(can('operations') ? [{ value: 'settings' as Tab, label: 'Settings' }] : []),
        ]}
      />
      <div className="mt-6">
        {tab === 'live' && <LiveTab id={id} detail={d} live={live} />}
        {tab === 'control' && <ControlTab detail={d} onChange={detail.reload} />}
        {tab === 'history' && <HistoryTab id={id} detail={d} />}
        {tab === 'stock' && <StockTab detail={d} />}
        {tab === 'timeline' && <TimelineTab id={id} onChange={detail.reload} />}
        {tab === 'settings' && <SettingsTab detail={d} onSaved={detail.reload} />}
      </div>
    </>
  );
}

function LiveTab({ id, detail, live }: { id: string; detail: any; live: any }) {
  const readings = useQuery<any[]>(`rooms/${id}/readings`);
  useEffect(() => {
    if (live) readings.setData((r) => (r ? [...r, live].slice(-400) : r));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);
  const peltier = detail.room.coolingType === 'peltier';
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
      <Card>
        <CardHeader title="What the room is doing" subtitle="Last 6 hours, minute by minute. Drag the slider or press Play to replay." />
        {readings.data ? (
          <TwinReplay readings={readings.data} incidents={detail.incidents} peltier={peltier} safe={[detail.view.safeMin, detail.view.safeMax]} live={live} />
        ) : (
          <div className="p-5"><Skeleton className="h-40" /></div>
        )}
      </Card>
      <Card>
        <CardHeader title="Health, explained" subtitle="Last 24 hours. Each line says what took points off." />
        {detail.health ? (
          <ul className="divide-y divide-line">
            {detail.health.factors.map((f: any) => (
              <li key={f.key} className="px-5 py-3">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-medium text-ink">{f.label}</span>
                  {f.lost ? <span className="tabular text-critical-ink">−{f.lost}</span> : <CheckCircle2 className="size-4 text-good" aria-label="No points lost" />}
                </div>
                <div className="text-[13px] text-ink-3">{f.detail}</div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Retired room" />
        )}
      </Card>
    </div>
  );
}

function HistoryTab({ id, detail }: { id: string; detail: any }) {
  const [range, setRange] = useState<'24h' | '7d' | '30d'>('24h');
  const history = useQuery<any[]>(`rooms/${id}/history?range=${range}`);
  const rows = history.data ?? [];
  const peltier = detail.room.coolingType === 'peltier';
  const fmt = (v: string) => (range === '24h' ? time(v) : new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Kigali' }));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented value={range} onChange={setRange} options={[{ value: '24h', label: '24 hours' }, { value: '7d', label: '7 days' }, { value: '30d', label: '30 days' }]} />
        <a href={`/api/admin/export/readings.csv?roomId=${id}&days=${range === '24h' ? 1 : range === '7d' ? 7 : 30}`} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[13px] text-ink-2 hover:bg-surface-3">
          <Download className="size-3.5" /> Raw readings (CSV)
        </a>
      </div>
      <ChartCard
        title="Temperature"
        subtitle={`Shaded: safe range ${detail.view.safeMin}–${detail.view.safeMax}°C`}
        series={[{ key: 'chamber', label: 'Chamber air' }, { key: 'product', label: 'Inside the crop' }]}
        rows={rows}
        xKey="at"
        xFormat={fmt}
        valueFormat={(v) => temp(v)}
      >
        {(s) => <TimeLines rows={rows} xKey="at" series={s} xFormat={fmt} yFormat={(v) => `${v}°`} valueFormat={(v) => temp(v)} band={[detail.view.safeMin, detail.view.safeMax]} />}
      </ChartCard>
      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Humidity" subtitle={`Shaded: ${detail.view.humidityMin}–${detail.view.humidityMax}%`} series={[{ key: 'humidity', label: 'Humidity' }]} rows={rows} xKey="at" xFormat={fmt} valueFormat={(v) => `${v}%`} height={200}>
          {(s) => <TimeLines rows={rows} xKey="at" series={s} xFormat={fmt} yFormat={(v) => `${v}%`} valueFormat={(v) => `${v}%`} band={[detail.view.humidityMin, detail.view.humidityMax]} />}
        </ChartCard>
        {peltier ? (
          <ChartCard title="Cooler hot side" subtitle="Highest per period · line: power is reduced above 55°C" series={[{ key: 'hotSide', label: 'Hot side', color: 'var(--series-2)' }]} rows={rows} xKey="at" xFormat={fmt} valueFormat={(v) => temp(v)} height={200}>
            {(s) => <TimeLines rows={rows} xKey="at" series={s} xFormat={fmt} yFormat={(v) => `${v}°`} valueFormat={(v) => temp(v)} refLine={{ y: 55, label: '55°C' }} />}
          </ChartCard>
        ) : (
          <ChartCard title="Ice bank" series={[{ key: 'iceBank', label: 'Ice bank water' }]} rows={rows} xKey="at" xFormat={fmt} valueFormat={(v) => temp(v)} height={200}>
            {(s) => <TimeLines rows={rows} xKey="at" series={s} xFormat={fmt} yFormat={(v) => `${v}°`} valueFormat={(v) => temp(v)} />}
          </ChartCard>
        )}
      </div>
      {peltier && (
        <ChartCard title="Cooler power" subtitle="Average % of maximum per period: a cooler that works harder week after week needs a check" series={[{ key: 'coolerDuty', label: 'Cooler power' }]} rows={rows} xKey="at" xFormat={fmt} valueFormat={(v) => `${v}%`} height={200}>
          {(s) => <Columns rows={rows} xKey="at" series={s} xFormat={fmt} yFormat={(v) => `${v}%`} valueFormat={(v) => `${v}%`} />}
        </ChartCard>
      )}
    </div>
  );
}

function StockTab({ detail }: { detail: any }) {
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <Card>
        <CardHeader title="In the room now" subtitle="Freshness is calculated from this room's sensor records since each batch was stored." />
        {detail.batches.length ? (
          <Table>
            <thead><tr><Th>Batch</Th><Th>Farmer</Th><Th>Stored</Th><Th>Freshness</Th></tr></thead>
            <tbody>
              {detail.batches.map((b: any) => (
                <tr key={b.id}>
                  <Td><Link href={`/stock/${b.id}`} className="font-medium hover:underline">{crop(b.crop)} · {qty(b.quantity, b.unit)}</Link><div className="font-mono text-[12px] text-ink-3">{b.code}{b.storageLocation ? ` · ${b.storageLocation}` : ''}{b.collectionRequestedAt ? ' · collection requested' : ''}</div></Td>
                  <Td><Link className="hover:underline" href={`/people/${b.farmerId}`}>{b.farmerName}</Link></Td>
                  <Td>{dateTime(b.storedAt)}<div className="text-[13px] text-ink-3">{ago(b.storedAt)}</div></Td>
                  <Td><FreshnessBadge value={b.freshness} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="Empty" body="No stock in this room." />
        )}
      </Card>
      <Card>
        <CardHeader title="Farmers" />
        <ul className="divide-y divide-line">
          {detail.farmers.map((f: any) => (
            <li key={f.id} className="flex items-center justify-between gap-2 px-5 py-3">
              <div>
                <Link href={`/people/${f.id}`} className="text-sm font-medium hover:underline">{f.name}</Link>
                <div className="text-[13px] text-ink-3">{f.phone}</div>
              </div>
              {f.locked_at ? <Badge tone="critical">Locked</Badge> : f.status === 'suspended' ? <Badge tone="warning">Suspended</Badge> : null}
            </li>
          ))}
          {!detail.farmers.length && <li className="px-5 py-6 text-sm text-ink-3">No farmers use this room yet.</li>}
        </ul>
      </Card>
    </div>
  );
}

function TimelineTab({ id, onChange }: { id: string; onChange: () => void }) {
  const timeline = useQuery<any[]>(`rooms/${id}/timeline`);
  const incidents = useQuery<any[]>(`incidents?roomId=${id}`);
  const can = useCan();
  const toast = useToast();
  const [ack, setAck] = useState<any>(null);
  const open = incidents.data?.filter((i) => !i.endedAt || !i.acknowledgedAt) ?? [];
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <Card>
        <CardHeader title="Timeline" subtitle="Incidents and every action on this room and its stock, newest first" />
        {!timeline.data ? (
          <div className="p-5"><Skeleton className="h-40" /></div>
        ) : timeline.data.length ? (
          <ol className="relative ml-6 border-l border-line py-4">
            {timeline.data.map((t, i) => (
              <li key={i} className="mb-4 ml-5 pr-5">
                <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full" style={{ background: t.kind === 'incident' ? 'var(--critical)' : t.kind === 'resolved' ? 'var(--good)' : t.kind === 'acknowledged' ? 'var(--series-1)' : 'var(--ink-3)' }} aria-hidden />
                <div className="text-sm text-ink">{t.kind === 'incident' || t.kind === 'resolved' || t.kind === 'acknowledged' ? `${incident(t.title.split(' ')[0])} ${t.title.split(' ').slice(1).join(' ')}` : t.title}</div>
                <div className="text-xs text-ink-3">{dateTime(t.at)}{t.actor ? ` · ${t.actor}` : ''}{t.note ? ` · “${t.note}”` : ''}</div>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState title="Nothing yet" />
        )}
      </Card>
      <Card>
        <CardHeader title="To handle" subtitle="Open, or resolved but not yet acknowledged" />
        {open.length ? (
          <ul className="divide-y divide-line">
            {open.map((i) => (
              <li key={i.id} className="space-y-2 px-5 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{incident(i.type)}</span>
                  {i.endedAt ? <Badge tone="good">Resolved</Badge> : <Badge tone="critical">Open · {duration(i.durationMin)}</Badge>}
                </div>
                <div className="text-[13px] text-ink-3">Started {dateTime(i.startedAt)}</div>
                {i.acknowledgedAt ? (
                  <div className="text-[13px] text-ink-2">Handled by {i.acknowledgedBy}: “{i.note}”</div>
                ) : (
                  can('operations', 'support') && <Button size="sm" onClick={() => setAck(i)}>Acknowledge</Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Nothing to handle" />
        )}
      </Card>
      <ActionDialog
        open={!!ack}
        onClose={() => setAck(null)}
        title={ack ? `Acknowledge: ${incident(ack.type)}` : ''}
        description="Record what was done or who is going to the site."
        confirmLabel="Acknowledge"
        reasonLabel="Note"
        reasonHint="E.g. “Called the farmer, the door was left open; closed now.”"
        minLength={3}
        onConfirm={async (note) => {
          await api(`incidents/${ack.id}/acknowledge`, { method: 'POST', body: { note } });
          toast('Incident acknowledged');
          await Promise.all([incidents.reload(), timeline.reload()]);
          onChange();
        }}
      />
    </div>
  );
}

function SettingsTab({ detail, onSaved }: { detail: any; onSaved: () => void }) {
  const room = detail.room;
  const crops = useQuery<{ crop: string }[]>('crops');
  const toast = useToast();
  const [form, setForm] = useState({
    name: room.name, district: room.district, sector: room.sector, crop: room.crop, capacityCrates: String(room.capacityCrates),
    peltierModules: String(room.peltierModules), storageRateKgDay: room.storageRateKgDay ?? '', storageRateCrateDay: room.storageRateCrateDay ?? '',
    coolingType: room.coolingType, status: room.status, firmwareChannel: room.firmwareChannel, latitude: room.latitude ?? '', longitude: room.longitude ?? '', notes: room.notes ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rotate, setRotate] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`rooms/${room.id}`, { method: 'PATCH', body: { ...form, capacityCrates: Number(form.capacityCrates), peltierModules: Number(form.peltierModules), storageRateKgDay: form.storageRateKgDay === '' ? null : Number(form.storageRateKgDay), storageRateCrateDay: form.storageRateCrateDay === '' ? null : Number(form.storageRateCrateDay), latitude: form.latitude === '' ? null : form.latitude, longitude: form.longitude === '' ? null : form.longitude } });
      toast('Room saved');
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <Card>
        <CardHeader title="Room details" subtitle="Changes are recorded in the audit trail with before and after values." />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Name" htmlFor="sn"><Input id="sn" value={form.name} onChange={set('name')} /></Field>
          <Field label="Main crop" htmlFor="sc" hint="Changes the safe ranges and the controller's settings.">
            <Select id="sc" value={form.crop} onChange={set('crop')}>{(crops.data ?? []).map((c) => <option key={c.crop} value={c.crop}>{crop(c.crop)}</option>)}</Select>
          </Field>
          <Field label="District" htmlFor="sd"><Select id="sd" value={form.district} onChange={set('district')}>{DISTRICTS.map((x) => <option key={x}>{x}</option>)}</Select></Field>
          <Field label="Sector" htmlFor="ss"><Input id="ss" value={form.sector} onChange={set('sector')} /></Field>
          <Field label="Cooling" htmlFor="st"><Select id="st" value={form.coolingType} onChange={set('coolingType')}><option value="peltier">Peltier (prototype)</option><option value="ice_bank">Ice bank (full size)</option></Select></Field>
          <Field label="Capacity (crates)" htmlFor="scap"><Input id="scap" value={form.capacityCrates} onChange={set('capacityCrates')} /></Field>
          <Field label="Status" htmlFor="sst" hint="Maintenance: no new check-ins. Retired: hidden from sign-up.">
            <Select id="sst" value={form.status} onChange={set('status')}><option value="active">Active</option><option value="maintenance">Maintenance</option><option value="retired">Retired</option></Select>
          </Field>
          <Field label="Firmware channel" htmlFor="sfc" hint="Beta rooms receive new firmware first.">
            <Select id="sfc" value={form.firmwareChannel} onChange={set('firmwareChannel')}><option value="stable">Stable</option><option value="beta">Beta</option></Select>
          </Field>
          <Field label="Peltier modules" htmlFor="smod" hint="How many modules cool this room."><Input id="smod" inputMode="numeric" value={form.peltierModules} onChange={set('peltierModules')} /></Field>
          <Field label="Storage rate per kg per day (RWF)" htmlFor="srk" hint="Empty = the system rate in Settings."><Input id="srk" inputMode="numeric" value={form.storageRateKgDay} onChange={set('storageRateKgDay')} /></Field>
          <Field label="Storage rate per crate per day (RWF)" htmlFor="src" hint="Empty = the system rate in Settings."><Input id="src" inputMode="numeric" value={form.storageRateCrateDay} onChange={set('storageRateCrateDay')} /></Field>
          <Field label="Latitude" htmlFor="slat"><Input id="slat" value={form.latitude} onChange={set('latitude')} /></Field>
          <Field label="Longitude" htmlFor="slng"><Input id="slng" value={form.longitude} onChange={set('longitude')} /></Field>
          <div className="sm:col-span-2"><Field label="Notes" htmlFor="sno"><Textarea id="sno" value={form.notes} onChange={set('notes')} /></Field></div>
          {error && <p className="text-sm text-critical-ink sm:col-span-2">{error}</p>}
          <div className="sm:col-span-2"><Button variant="primary" onClick={save} loading={busy}>Save changes</Button></div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Controller token and links" />
        <div className="space-y-3 p-5 text-sm text-ink-2">
          <p className="text-[13px]">Controller id (DEVICE_ID): <span className="font-mono font-medium text-ink">{room.id}</span>{room.legacyId ? <span className="text-ink-3"> · old id {room.legacyId} still accepted</span> : null}</p>
          <p className="text-[13px]">Operators: {detail.operators.length ? detail.operators.map((o: any) => o.name).join(', ') : <span className="text-ink-3">none assigned</span>}</p>
          <p>The controller proves who it is with a secret token. Issue a new one if the controller was replaced or the token may have leaked: the old one stops working at once.</p>
          <p className="text-[13px] text-ink-3">{room.deviceTokenRotatedAt ? `Last issued ${dateTime(room.deviceTokenRotatedAt)}` : 'Issued when the room was created'}</p>
          <Button icon={<KeyRound className="size-4" />} onClick={() => setRotate(true)}>Issue new token</Button>
        </div>
      </Card>
      <ActionDialog
        open={rotate}
        onClose={() => setRotate(false)}
        title="Issue a new controller token?"
        description="The controller stops uploading until its config.h has the new token. Readings it keeps in flash meanwhile are sent once it has it."
        confirmLabel="Issue new token"
        danger
        onConfirm={async () => {
          const r = await api<{ deviceToken: string }>(`rooms/${room.id}/rotate-token`, { method: 'POST' });
          setToken(r.deviceToken);
          onSaved();
        }}
      />
      <Modal open={!!token} onClose={() => setToken(null)} title="New controller token" footer={<Button variant="primary" onClick={() => setToken(null)}>Done</Button>}>
        {token && <SecretBox label="DEVICE_TOKEN for config.h" value={token} />}
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------- remote control

const STATUS_TONE: Record<string, 'neutral' | 'good' | 'warning' | 'critical' | 'info'> = { pending: 'info', sent: 'info', done: 'good', failed: 'critical', expired: 'neutral', cancelled: 'neutral' };
const STATUS_TEXT: Record<string, string> = { pending: 'Waiting for the room', sent: 'Sent, waiting for the answer', done: 'Carried out', failed: 'Refused by the room', expired: 'Not delivered in time', cancelled: 'Cancelled' };

function describeCommand(c: any) {
  const p = c.params ?? {};
  const min = p.minutes ? ` for ${duration(p.minutes)}` : '';
  switch (c.type) {
    case 'set_target': return p.targetC === null ? 'Target back to the crop profile' : `Target ${p.targetC}°C${min}`;
    case 'cooling': return p.mode === 'auto' ? 'Cooling back to automatic' : `Cooling off${min}`;
    case 'inside_fan': return p.mode === 'auto' ? 'Inside fan back to automatic' : `Inside fan ${p.mode === 'off' ? 'off' : 'on'}${min}`;
    case 'hot_fan': return p.mode === 'auto' ? 'Hot-side fan back to automatic' : `Hot-side fan ${p.mode === 'off' ? 'off' : 'on'}${min}`;
    default: return c.type;
  }
}

const MINUTES: Record<string, number[]> = {
  set_target: [30, 60, 120, 240, 720, 1440],
  cooling: [30, 60, 120, 240, 720, 1440],
  inside_fan: [15, 30, 60, 120, 480, 1440],
  hot_fan: [15, 30, 60, 120, 480, 1440],
};

function ControlTab({ detail, onChange }: { detail: any; onChange: () => void }) {
  const can = useCan();
  const mayControl = can('operations', 'operator');
  const range = detail.targetRange;
  const ctl = detail.control ?? {};
  const [pending, setPending] = useState<{ type: string; params: any; title: string } | null>(null);
  const [target, setTarget] = useState(String(range.profile));
  const [minutes, setMinutes] = useState<Record<string, string>>({ set_target: '60', cooling: '30', inside_fan: '30', hot_fan: '30' });
  const toast = useToast();
  const peltier = detail.room.coolingType === 'peltier';

  const ask = (type: string, mode: 'start' | 'off' | 'auto') => {
    const m = Number(minutes[type]);
    if (type === 'set_target') {
      if (mode === 'auto') return setPending({ type, params: { targetC: null }, title: 'Return to the crop profile target?' });
      return setPending({ type, params: { targetC: Number(target), minutes: m }, title: `Hold ${Number(target)}°C for ${duration(m)}?` });
    }
    const name = { cooling: 'Cooling', inside_fan: 'The inside fan', hot_fan: 'The hot-side fan' }[type] as string;
    if (mode === 'auto') return setPending({ type, params: { mode: 'auto' }, title: type === 'cooling' ? 'Switch cooling ON (automatic temperature control)?' : `${name}: back to automatic?` });
    const wanted = type === 'cooling' || mode === 'off' ? 'off' : 'on';
    setPending({ type, params: { mode: wanted, minutes: m }, title: `${name} ${wanted === 'off' ? 'OFF' : 'ON'} for ${duration(m)}?` });
  };

  const left = (min: number | null | undefined) => (min ? `${duration(min)} left` : 'automatic');
  const rows = [
    { type: 'set_target', title: 'Target temperature', now: ctl.targetMinutesLeft ? `${ctl.targetC}°C, ${left(ctl.targetMinutesLeft)}` : `${range.profile}°C (crop profile)`, hint: `Allowed for this crop: ${range.min}–${range.max}°C. The room's freeze guard and alarm limits stay in force.` },
    { type: 'cooling', title: 'Cooling', now: ctl.coolingOffMinutesLeft ? `OFF, ${left(ctl.coolingOffMinutesLeft)}` : 'ON (automatic temperature control)', hint: 'ON: the room holds its temperature by itself. OFF: pauses the cooler (a defrost, a repair). It switches back on by itself if the room reaches its alarm temperature, or after the time you choose.' },
    { type: 'inside_fan', title: 'Inside fan', now: ctl.insideFanOnMinutesLeft ? `ON, ${left(ctl.insideFanOnMinutesLeft)}` : ctl.insideFanOffMinutesLeft ? `OFF, ${left(ctl.insideFanOffMinutesLeft)}` : 'automatic', hint: 'Stirs the air. OFF is honoured only while the cooler is not running (the cold side needs its fan, or the coil frosts). Stops by itself while the door is open.' },
    { type: 'hot_fan', title: 'Hot-side (external) fan', now: ctl.hotFanOnMinutesLeft ? `ON, ${left(ctl.hotFanOnMinutesLeft)}` : ctl.hotFanOffMinutesLeft ? `OFF, ${left(ctl.hotFanOffMinutesLeft)}` : 'automatic', hint: 'OFF is honoured only while the cooler is stopped and the heatsink is cool: otherwise the Peltier module could burn out.' },
  ];

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        <Card>
          <CardHeader title="Remote control" subtitle="Control the room from here. Each setting lasts for the time you choose, then the room returns to automatic by itself. The room keeps controlling its temperature and protecting its equipment whatever you send, and every command is recorded with who sent it and why." />
          {ctl.localLock && <p className="mx-5 mt-4 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-sm text-warning-ink">On-site control is ON: someone at the room switched the key switch, so remote commands are refused until it is switched off. The room still controls its temperature automatically.</p>}
          {!peltier && <p className="px-5 pt-4 text-[13px] text-ink-3">This is an ice-bank room: the controller supports the target temperature and the fans.</p>}
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.type} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
                <div className="min-w-[200px] flex-1">
                  <div className="text-sm font-medium text-ink">{r.title}</div>
                  <div className="text-[13px] text-ink-2">Now: {r.now}</div>
                  <div className="mt-0.5 text-[12px] text-ink-3">{r.hint}</div>
                </div>
                {mayControl ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {r.type === 'set_target' && <Input aria-label="Target in °C" value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" className="h-9 w-20" />}
                    <Select aria-label="For how long" value={minutes[r.type]} onChange={(e) => setMinutes((m) => ({ ...m, [r.type]: e.target.value }))} className="h-9 w-32">{MINUTES[r.type].map((m) => <option key={m} value={m}>{duration(m)}</option>)}</Select>
                    <Button size="sm" variant="primary" icon={<Power className="size-3.5" />} onClick={() => ask(r.type, r.type === 'set_target' ? 'start' : r.type === 'cooling' ? 'off' : 'start')} disabled={ctl.localLock}>{r.type === 'set_target' ? 'Set' : r.type === 'cooling' ? 'Switch OFF' : 'Switch ON'}</Button>
                    {r.type !== 'set_target' && r.type !== 'cooling' && <Button size="sm" onClick={() => ask(r.type, 'off')} disabled={ctl.localLock}>Switch OFF</Button>}
                    <Button size="sm" onClick={() => ask(r.type, 'auto')} disabled={ctl.localLock}>{r.type === 'cooling' ? 'Switch ON (automatic)' : 'Automatic'}</Button>
                  </div>
                ) : <Badge>View only</Badge>}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Recent commands" subtitle="Newest first" />
          {detail.commands.length ? (
            <Table>
              <thead><tr><Th>Command</Th><Th>Sent by</Th><Th>Status</Th></tr></thead>
              <tbody>
                {detail.commands.map((c: any) => (
                  <tr key={c.id}>
                    <Td><span className="font-medium">{describeCommand(c)}</span><div className="text-[13px] text-ink-3">{c.reason}</div></Td>
                    <Td>{c.requestedBy}<div className="text-[13px] text-ink-3">{dateTime(c.createdAt)}</div></Td>
                    <Td>
                      <Badge tone={STATUS_TONE[c.status]}>{STATUS_TEXT[c.status]}</Badge>
                      <div className="text-[12px] text-ink-3">{c.sentVia ? `via ${c.sentVia === 'mqtt' ? 'MQTT' : 'HTTPS'}` : ''}{c.result?.message && c.status === 'failed' ? ` · ${c.result.message}` : ''}</div>
                      {mayControl && (c.status === 'pending' || c.status === 'sent') && <Button size="sm" variant="ghost" onClick={async () => { try { await api(`rooms/${detail.room.id}/commands/${c.id}/cancel`, { method: 'POST' }); onChange(); } catch (e) { toast(errorMessage(e), 'critical'); } }}>Cancel</Button>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : <EmptyState title="No commands yet" />}
        </Card>
      </div>
      <div className="space-y-6">
        <Card>
          <CardHeader title="Connection" />
          <ul className="divide-y divide-line text-sm">
            <li className="flex justify-between px-5 py-3"><span className="text-ink-2">Last upload</span><span>{ago(detail.room.lastUploadAt)} · {detail.room.lastUploadVia === 'mqtt' ? 'MQTT' : detail.room.lastUploadVia === 'https' ? 'HTTPS' : '–'}</span></li>
            <li className="flex justify-between px-5 py-3"><span className="text-ink-2">MQTT (backup)</span>{detail.mqtt.connected ? <Badge tone="good">Connected</Badge> : <Badge>{detail.mqtt.seenAt ? `Last seen ${ago(detail.mqtt.seenAt)}` : 'Not seen yet'}</Badge>}</li>
            <li className="px-5 py-3 text-[13px] text-ink-3">The room works without any link: it keeps cooling and keeps its readings for about a week, then sends them. A command reaches it as soon as either link is up.</li>
          </ul>
        </Card>
        <Card>
          <CardHeader title="What to check" subtitle="From this room's readings and its crop profile" />
          {detail.recommendations.items.length ? (
            <ul className="divide-y divide-line">
              {detail.recommendations.items.map((r: any) => (
                <li key={r.key} className="flex gap-3 px-5 py-3 text-sm">
                  <Lightbulb className={`mt-0.5 size-4 shrink-0 ${r.severity === 'alert' ? 'text-critical' : r.severity === 'warn' ? 'text-warning' : 'text-ink-3'}`} />
                  <span className="text-ink-2">{r.text}</span>
                </li>
              ))}
            </ul>
          ) : <div className="flex items-center gap-2 px-5 py-4 text-sm text-ink-2"><CheckCircle2 className="size-4 text-good" /> Nothing to check right now.</div>}
        </Card>
        <Card>
          <CardHeader title={`Storing ${crop(detail.recommendations.cropTips.crop)}`} subtitle="Crop profile guidance" />
          <ul className="list-disc space-y-1.5 px-9 py-4 text-[13px] text-ink-2">{detail.recommendations.cropTips.tips.map((t: string) => <li key={t}>{t}</li>)}</ul>
        </Card>
      </div>
      <ActionDialog
        open={!!pending}
        onClose={() => setPending(null)}
        title={pending?.title ?? ''}
        description="The room carries it out when it receives it. It is recorded in the audit trail."
        confirmLabel="Send to the room"
        reasonLabel="Why"
        reasonHint="E.g. “Defrosting the coil” or “Small load, saving power.”"
        minLength={5}
        onConfirm={async (reason) => {
          await api(`rooms/${detail.room.id}/commands`, { method: 'POST', body: { type: pending!.type, params: pending!.params, reason } });
          toast('Command sent');
          onChange();
        }}
      />
    </div>
  );
}
