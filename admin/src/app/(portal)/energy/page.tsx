'use client';

import { Download, FlaskConical, Zap } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { useCan } from '@/components/admin-context';
import { ChartCard, Columns } from '@/components/charts';
import { Badge, Card, CardHeader, EmptyState, ErrorBox, PageHeader, Segmented, Select, Skeleton, StatTile, Table, Td, Th } from '@/components/ui';
import { useQuery } from '@/lib/api';
import { num, pct, shortDay, temp } from '@/lib/format';

const kwh = (v: number | null | undefined) => (v === null || v === undefined ? '–' : `${num(v, 1)} kWh`);

export default function EnergyPage() {
  const can = useCan();
  const [days, setDays] = useState<'7' | '30' | '90'>('7');
  const report = useQuery<any>(`energy?days=${days}`, { refreshMs: 120_000 });
  const [roomId, setRoomId] = useState('');
  const d = report.data;
  const rooms: any[] = d?.rooms ?? [];
  const chosen = roomId || rooms[0]?.roomId || '';
  const daily = (d?.daily ?? []).filter((x: any) => x.roomId === chosen).map((x: any) => ({ ...x, kwhDay: x.wh === null ? null : x.wh / 1000, solarKwhDay: x.solarWh === null ? null : x.solarWh / 1000 }));
  const simulated = rooms.reduce((s, r) => s + r.simulatedReadings, 0);
  const best = [...rooms].filter((r) => r.whPerCrateDay !== null).sort((a, b) => a.whPerCrateDay - b.whPerCrateDay)[0];

  return (
    <>
      <PageHeader
        title="Energy"
        subtitle="Electricity used by the coolers, solar generation and battery, room by room. Only what a room has installed is counted: a room without a power meter shows a dash, not zero."
        actions={
          <>
            <Segmented value={days} onChange={setDays} options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} />
            {can('support', 'operations', 'market') && <a href={`/api/admin/export/energy.csv?days=${days}`} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[13px] text-ink-2 hover:bg-surface-3"><Download className="size-3.5" /> energy.csv</a>}
          </>
        }
      />
      {report.error && <ErrorBox error={report.error} onRetry={report.reload} />}
      {simulated > 0 && (
        <div className="mb-5 flex items-center gap-2 rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning-ink">
          <FlaskConical className="size-4 shrink-0" /> {num(simulated)} of these readings come from the development simulator, not from real controllers.
        </div>
      )}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Cooler energy" value={d ? kwh(d.totals.kwh) : '–'} sub={`all rooms, ${days} days`} icon={<Zap className="size-4" />} />
        <StatTile label="Solar generated" value={d ? (d.totals.solarKwh === null ? 'no solar meter' : kwh(d.totals.solarKwh)) : '–'} sub="rooms with a solar meter" />
        <StatTile label="Most efficient" value={best ? best.name : '–'} sub={best ? `${num(best.whPerCrateDay)} Wh per crate per day` : 'needs crates in storage'} />
        <StatTile label="Rooms" value={d ? String(rooms.length) : '–'} sub="in this report" />
      </div>

      <Card className="mb-6">
        <CardHeader title="Comparing the rooms" subtitle="Energy per crate stored per day is the fair comparison: a fuller room should use more energy in total, not more per crate. Lower is better." />
        {!d ? <div className="p-4"><Skeleton className="h-32" /></div> : !rooms.length ? <EmptyState title="No rooms" /> : (
          <Table>
            <thead><tr><Th>Room</Th><Th align="right">Cooler energy</Th><Th align="right">Avg power</Th><Th align="right">Per crate per day</Th><Th align="right">Solar</Th><Th align="right">Battery low / avg</Th><Th align="right">Held below outside</Th><Th align="right">In safe range</Th></tr></thead>
            <tbody>
              {rooms.map((r) => (
                <tr key={r.roomId}>
                  <Td><Link href={`/rooms/${r.roomId}`} className="font-medium hover:underline">{r.name}</Link> <span className="font-mono text-[12px] text-ink-3">{r.roomId}</span>
                    <div className="text-[13px] text-ink-3">{r.coolingType === 'peltier' ? `${r.peltierModules} Peltier module${r.peltierModules === 1 ? '' : 's'}` : 'Ice bank'}{r.simulatedReadings ? ' · simulated data' : ''}</div></Td>
                  <Td align="right">{r.hasPowerMeter ? kwh(r.kwh) : <span className="text-ink-3">no meter</span>}</Td>
                  <Td align="right">{r.avgWatts === null ? '–' : `${num(r.avgWatts)} W`}{r.avgDutyPct !== null && <div className="text-[12px] text-ink-3">{r.avgDutyPct}% duty</div>}</Td>
                  <Td align="right">{r.whPerCrateDay === null ? '–' : <>{num(r.whPerCrateDay)} Wh {r.efficiencyRank === 1 && rooms.length > 1 && <Badge tone="good">best</Badge>}</>}<div className="text-[12px] text-ink-3">{r.avgCrates} crates on average</div></Td>
                  <Td align="right">{r.hasSolarMeter ? <>{kwh(r.solarKwh)}<div className="text-[12px] text-ink-3">{r.solarSharePct === null ? '' : `${r.solarSharePct}% of use`}</div></> : <span className="text-ink-3">no meter</span>}</Td>
                  <Td align="right">{r.hasBattery ? `${r.batteryMinPct}% / ${pct(r.batteryAvgPct)}` : <span className="text-ink-3">–</span>}</Td>
                  <Td align="right">{r.liftC === null ? '–' : `${num(r.liftC, 1)}°C`}<div className="text-[12px] text-ink-3">{temp(r.avgChamberC)} inside, {temp(r.avgOutsideC)} outside</div></Td>
                  <Td align="right">{pct(r.inRangePct)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Cooler energy by room" subtitle={`kWh in the last ${days} days`} series={[{ key: 'kwh', label: 'Cooler energy' }, { key: 'solarKwh', label: 'Solar generated' }]} rows={rooms} xKey="name" valueFormat={(v) => kwh(v)} height={240}>
          {(s) => <Columns rows={rooms} xKey="name" series={s} yFormat={(v) => `${v}`} valueFormat={(v) => kwh(v)} />}
        </ChartCard>
        <ChartCard
          title="Day by day"
          subtitle="Cooler energy and solar generation for one room"
          series={[{ key: 'kwhDay', label: 'Cooler energy' }, { key: 'solarKwhDay', label: 'Solar generated' }]}
          rows={daily}
          xKey="day"
          xFormat={shortDay}
          valueFormat={(v) => kwh(v)}
          height={240}
          actions={<Select value={chosen} onChange={(e) => setRoomId(e.target.value)} className="h-8 w-44" aria-label="Room">{rooms.map((r) => <option key={r.roomId} value={r.roomId}>{r.name}</option>)}</Select>}
        >
          {(s) => <Columns rows={daily} xKey="day" series={s} xFormat={shortDay} yFormat={(v) => `${v}`} valueFormat={(v) => kwh(v)} />}
        </ChartCard>
      </div>
    </>
  );
}
