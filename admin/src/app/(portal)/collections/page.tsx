'use client';

import { Download, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { useCan } from '@/components/admin-context';
import { PayDialog } from '@/components/domain/stock';
import { Badge, Button, Card, EmptyState, ErrorBox, PageHeader, Segmented, Select, Skeleton, StatTile, Table, Td, Th } from '@/components/ui';
import { useQuery } from '@/lib/api';
import { crop, dateTime, qty, rwf } from '@/lib/format';

export default function CollectionsPage() {
  const can = useCan();
  const [payment, setPayment] = useState<'' | 'unpaid' | 'paid'>('');
  const [days, setDays] = useState<'30' | '90'>('30');
  const [roomId, setRoomId] = useState('');
  const rooms = useQuery<any[]>('rooms');
  const params = new URLSearchParams({ days });
  if (payment) params.set('payment', payment);
  if (roomId) params.set('roomId', roomId);
  const list = useQuery<any>(`collections?${params}`, { refreshMs: 60_000 });
  const [paying, setPaying] = useState<any>(null);
  const d = list.data;

  return (
    <>
      <PageHeader
        title="Collections & storage charges"
        subtitle="Every time produce leaves a cold room: who collected it, what storage cost (per day, fixed at that moment) and whether it was paid."
        actions={<a href={`/api/admin/export/collections.csv?days=${days}`} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[13px] text-ink-2 hover:bg-surface-3"><Download className="size-3.5" /> collections.csv</a>}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatTile label="Unpaid" value={d ? rwf(d.unpaidRwf) : '–'} sub="storage charges in this list" tone={d?.unpaidRwf ? 'warning' : undefined} />
        <StatTile label="Collections" value={d ? String(d.collections.length) : '–'} sub={`last ${days} days`} />
        <StatTile label="Charged" value={d ? rwf(d.collections.reduce((s: number, c: any) => s + (c.chargeRwf ?? 0), 0)) : '–'} sub="all payment states" />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented value={payment} onChange={setPayment} options={[{ value: '', label: 'All' }, { value: 'unpaid', label: 'Unpaid' }, { value: 'paid', label: 'Paid' }]} />
        <Segmented value={days} onChange={setDays} options={[{ value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} />
        <Select value={roomId} onChange={(e) => setRoomId(e.target.value)} className="w-56" aria-label="Room"><option value="">All rooms</option>{rooms.data?.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.id})</option>)}</Select>
      </div>
      {list.error && <ErrorBox error={list.error} onRetry={list.reload} />}
      <Card>
        {!d ? <div className="p-4"><Skeleton className="h-32" /></div> : !d.collections.length ? <EmptyState icon={<Wallet className="size-6" />} title="No collections" body="Collections appear here when staff record them, or when a market order is accepted." /> : (
          <Table>
            <thead><tr><Th>When</Th><Th>Batch</Th><Th>Collected by</Th><Th>Room</Th><Th align="right">Days × rate</Th><Th align="right">Charge</Th><Th>Payment</Th></tr></thead>
            <tbody>
              {d.collections.map((c: any) => (
                <tr key={c.id}>
                  <Td>{dateTime(c.collectedAt)}<div className="text-[13px] text-ink-3">{c.kind === 'sale' ? 'Market sale' : `recorded by ${c.recordedBy}`}</div></Td>
                  <Td><Link className="font-medium hover:underline" href={`/stock/${c.batchId}`}>{crop(c.crop)} · {qty(c.quantity, c.unit)}</Link><div className="font-mono text-[12px] text-ink-3">{c.batchCode} · {c.farmerName}</div></Td>
                  <Td>{c.collectedBy}</Td>
                  <Td>{c.roomName}</Td>
                  <Td align="right">{c.rateRwf === null ? '–' : `${c.days} × ${c.rateRwf}`}</Td>
                  <Td align="right">{c.chargeRwf === null ? 'no rate' : rwf(c.chargeRwf)}</Td>
                  <Td>{c.paymentStatus === 'unpaid' ? (c.chargeRwf !== null && can('operations', 'operator') ? <Button size="sm" onClick={() => setPaying(c)}>Record payment</Button> : <Badge tone="warning">Unpaid</Badge>) : <Badge tone="good">{c.paymentStatus === 'waived' ? 'Waived' : `Paid · ${c.paymentMethod}`}</Badge>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {paying && <PayDialog collection={paying} onClose={() => setPaying(null)} onDone={list.reload} />}
    </>
  );
}
