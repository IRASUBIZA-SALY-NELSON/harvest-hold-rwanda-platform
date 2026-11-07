'use client';

import Link from 'next/link';
import { useState } from 'react';

import { ChartCard, Columns, TimeLines } from '@/components/charts';
import { Card, CardHeader, ErrorBox, PageHeader, Segmented, Skeleton, StatTile, Table, Td, Th } from '@/components/ui';
import { useQuery } from '@/lib/api';
import { compact, crop, energy, num, pct, rwf, rwfCompact, shortDay } from '@/lib/format';

/** Long rows (day, key, value) → one row per day with a column per key. Missing days are filled in. */
function pivot(rows: any[], keyField: string, valueField: string, days: string[]): Record<string, any>[] {
  const byDay = new Map<string, Record<string, any>>(days.map((d) => [d, { day: d }]));
  for (const r of rows) {
    const row = byDay.get(r.day);
    if (row) row[r[keyField]] = Number(r[valueField]);
  }
  return [...byDay.values()];
}

function lastDays(n: number): string[] {
  const out: string[] = [];
  const kigaliNow = new Date(Date.now() + 2 * 3_600_000);
  for (let i = n - 1; i >= 0; i--) out.push(new Date(kigaliNow.getTime() - i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

export default function AnalyticsPage() {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const a = useQuery<any>(`analytics?days=${days}`);
  const rooms = useQuery<any[]>('rooms');

  if (a.error) return <ErrorBox error={a.error} onRetry={a.reload} />;
  const d = a.data;
  const dayList = lastDays(days);
  const roomName = (id: string) => rooms.data?.find((r) => r.id === id)?.name ?? id;
  const roomIds: string[] = d ? [...new Set<string>(d.compliance.map((c: any) => c.room_id))] : [];
  const energyRooms: string[] = d ? [...new Set<string>(d.energy.map((c: any) => c.room_id))] : [];

  const compliance = d ? pivot(d.compliance, 'room_id', 'in_range', dayList) : [];
  const energyRows = d ? pivot(d.energy, 'room_id', 'wh', dayList) : [];
  const orderRows = d ? dayList.map((day) => ({ day, ...(d.orders.find((o: any) => o.day === day) ?? { orders: 0, accepted: 0, gmv: 0 }) })) : [];
  const certRows = d ? pivot(d.certificates, 'freshness', 'n', dayList) : [];
  const checkinRows = d ? dayList.map((day) => ({ day, kg: Number(d.checkins.find((c: any) => c.day === day)?.kg ?? 0) })) : [];
  const signupRows = d ? pivot(d.signups, 'role', 'n', dayList) : [];

  const totalGmv = orderRows.reduce((s, r) => s + Number(r.gmv ?? 0), 0);
  const totalOrders = orderRows.reduce((s, r) => s + Number(r.orders ?? 0), 0);
  const totalEnergy = d ? d.energy.reduce((s: number, r: any) => s + Number(r.wh), 0) : 0;
  const totalKg = checkinRows.reduce((s, r) => s + r.kg, 0);
  const avgCompliance = d && d.compliance.length ? d.compliance.reduce((s: number, r: any) => s + Number(r.in_range), 0) / d.compliance.length : null;
  const fmtDay = (v: string) => shortDay(v);
  // A share can't go above 100%: fix the top, and start a little below the worst day.
  const worstDay = d && d.compliance.length ? Math.min(...d.compliance.map((c: any) => Number(c.in_range))) : 90;
  const complianceFloor = Math.max(0, Math.floor((worstDay - 2) / 5) * 5);

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle="How well the rooms keep crops cold, what it costs in energy, and how the market is doing. Every chart has a table view."
        actions={<Segmented value={String(days) as '7' | '30' | '90'} onChange={(v) => setDays(Number(v) as 7 | 30 | 90)} options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} />}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        {!d ? Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-[104px] rounded-xl" />) : (
          <>
            <StatTile label="Time in safe range" value={pct(avgCompliance, 1)} sub="all rooms, by reading" tone={avgCompliance !== null && avgCompliance < 95 ? 'warning' : undefined} />
            <StatTile label="Cooler energy" value={energy(totalEnergy)} sub={`${days} days, Peltier rooms`} />
            <StatTile label="Checked in" value={`${compact(totalKg)} kg`} sub="crates counted as 20 kg" />
            <StatTile label="Sales" value={rwfCompact(totalGmv)} sub={`${num(totalOrders)} orders placed`} />
            <StatTile label="Average storage" value={d.avgStorageHours === null ? '–' : `${num(Number(d.avgStorageHours))} h`} sub="per batch" />
          </>
        )}
      </div>

      {!d ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : (
        <div className="space-y-6">
          <ChartCard
            title="Time in the safe range, per room"
            subtitle="Share of readings inside the crop's temperature range, each day"
            series={roomIds.slice(0, 8).map((id) => ({ key: id, label: roomName(id) }))}
            rows={compliance}
            xKey="day"
            xFormat={fmtDay}
            valueFormat={(v) => pct(v, 1)}
          >
            {(s) => <TimeLines rows={compliance} xKey="day" series={s} xFormat={fmtDay} yFormat={(v) => `${v}%`} valueFormat={(v) => pct(v, 1)} yDomain={[complianceFloor, 100]} />}
          </ChartCard>

          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard
              title="Cooler energy per day"
              subtitle="From the power meters (Wh)"
              series={energyRooms.slice(0, 8).map((id) => ({ key: id, label: roomName(id) }))}
              rows={energyRows}
              xKey="day"
              xFormat={fmtDay}
              valueFormat={(v) => energy(v)}
            >
              {(s) => <Columns rows={energyRows} xKey="day" series={s} xFormat={fmtDay} yFormat={(v) => compact(v)} valueFormat={(v) => energy(v)} stacked />}
            </ChartCard>
            <ChartCard
              title="Certificates issued"
              subtitle="By result"
              series={[
                { key: 'fresh', label: 'Kept fresh', color: 'var(--good)' },
                { key: 'attention', label: 'Check quality', color: 'var(--serious)' },
                { key: 'unknown', label: 'No data', color: 'var(--ink-3)' },
              ]}
              rows={certRows}
              xKey="day"
              xFormat={fmtDay}
            >
              {(s) => <Columns rows={certRows} xKey="day" series={s} xFormat={fmtDay} stacked />}
            </ChartCard>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard title="Sales per day" subtitle="Accepted orders (RWF)" series={[{ key: 'gmv', label: 'Sales' }]} rows={orderRows} xKey="day" xFormat={fmtDay} valueFormat={(v) => rwf(v)}>
              {(s) => <Columns rows={orderRows} xKey="day" series={s} xFormat={fmtDay} yFormat={(v) => compact(v)} valueFormat={(v) => rwf(v)} />}
            </ChartCard>
            <ChartCard title="Orders per day" series={[{ key: 'orders', label: 'Placed' }, { key: 'accepted', label: 'Accepted' }]} rows={orderRows} xKey="day" xFormat={fmtDay}>
              {(s) => <Columns rows={orderRows} xKey="day" series={s} xFormat={fmtDay} />}
            </ChartCard>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard title="Checked into cold rooms" subtitle="kg per day" series={[{ key: 'kg', label: 'Checked in' }]} rows={checkinRows} xKey="day" xFormat={fmtDay} valueFormat={(v) => `${num(v)} kg`}>
              {(s) => <Columns rows={checkinRows} xKey="day" series={s} xFormat={fmtDay} yFormat={(v) => compact(v)} valueFormat={(v) => `${num(v)} kg`} />}
            </ChartCard>
            <ChartCard title="New accounts" series={[{ key: 'farmer', label: 'Farmers' }, { key: 'buyer', label: 'Buyers' }]} rows={signupRows} xKey="day" xFormat={fmtDay}>
              {(s) => <Columns rows={signupRows} xKey="day" series={s} xFormat={fmtDay} stacked />}
            </ChartCard>
          </div>

          <div className="grid gap-6 xl:grid-cols-3">
            <Card>
              <CardHeader title="Prices" subtitle="Listings created in this period" />
              <Table>
                <thead><tr><Th>Crop</Th><Th align="right">Median</Th><Th align="right">Range</Th></tr></thead>
                <tbody>
                  {d.prices.map((p: any) => (
                    <tr key={`${p.crop}-${p.unit}`}>
                      <Td>{crop(p.crop)}<div className="text-[13px] text-ink-3">per {p.unit} · {p.listings} listings</div></Td>
                      <Td align="right">{rwf(p.median)}</Td>
                      <Td align="right" className="text-ink-2">{num(p.min)}–{num(p.max)}</Td>
                    </tr>
                  ))}
                  {!d.prices.length && <tr><Td className="text-ink-3">No listings</Td></tr>}
                </tbody>
              </Table>
            </Card>
            <Card>
              <CardHeader title="Districts" />
              <Table>
                <thead><tr><Th>District</Th><Th align="right">Farmers</Th><Th align="right">Rooms</Th><Th align="right">Sales</Th></tr></thead>
                <tbody>
                  {d.districts.map((r: any) => (
                    <tr key={r.district}>
                      <Td>{r.district}</Td>
                      <Td align="right">{num(r.farmers)}</Td>
                      <Td align="right">{num(r.rooms)}</Td>
                      <Td align="right">{rwfCompact(r.gmv)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
            <Card>
              <CardHeader title="Top farmers" subtitle="By accepted sales" />
              <Table>
                <thead><tr><Th>Farmer</Th><Th align="right">Orders</Th><Th align="right">Sales</Th></tr></thead>
                <tbody>
                  {d.topFarmers.map((f: any) => (
                    <tr key={f.id}>
                      <Td><Link className="hover:underline" href={`/people/${f.id}`}>{f.name}</Link><div className="text-[13px] text-ink-3">{f.district}</div></Td>
                      <Td align="right">{num(f.orders)}</Td>
                      <Td align="right">{rwfCompact(f.gmv)}</Td>
                    </tr>
                  ))}
                  {!d.topFarmers.length && <tr><Td className="text-ink-3">No sales yet</Td></tr>}
                </tbody>
              </Table>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
