'use client';

import { Boxes, Plus, QrCode } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { useCan } from '@/components/admin-context';
import { CollectionBadge } from '@/components/domain/stock';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorBox, Field, FreshnessBadge, Input, Meter, Modal, PageHeader, Segmented, Select, Skeleton, Table, Td, Th, useToast } from '@/components/ui';
import { api, useQuery } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { CROP, crop, date, dateTime, num, qty } from '@/lib/format';

const UNITS = [['kg', 'kilograms'], ['crate', 'crates']] as const;
const today = () => new Date(Date.now() + 2 * 3_600_000).toISOString().slice(0, 10);

export default function InventoryPage() {
  const can = useCan();
  const [status, setStatus] = useState<'stored' | 'all'>('stored');
  const [roomId, setRoomId] = useState('');
  const [cropFilter, setCropFilter] = useState('');
  const [q, setQ] = useState('');
  const [requested, setRequested] = useState(false);
  const [adding, setAdding] = useState(false);
  const params = new URLSearchParams({ status });
  if (roomId) params.set('roomId', roomId);
  if (cropFilter) params.set('crop', cropFilter);
  if (q.trim()) params.set('q', q.trim());
  if (requested) params.set('collection', 'requested');
  const inv = useQuery<any>(`inventory?${params}`, { refreshMs: 60_000 });
  const d = inv.data;

  return (
    <>
      <PageHeader
        title="Inventory"
        subtitle="The produce in every cold room. Each batch has its own code and QR label; freshness comes from the room's sensor records since it was stored."
        actions={can('operations', 'operator') && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Register produce</Button>}
      />
      {inv.error && <ErrorBox error={inv.error} onRetry={inv.reload} />}

      <div className="mb-6 grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader title="By location" subtitle="Available stock in each cold room" />
          {!d ? <div className="p-4"><Skeleton className="h-24" /></div> : (
            <Table>
              <thead><tr><Th>Room</Th><Th>Kilograms</Th><Th>Crates</Th><Th>Batches</Th><Th>Full</Th></tr></thead>
              <tbody>
                {d.byRoom.map((r: any) => (
                  <tr key={r.roomId} className="cursor-pointer hover:bg-surface-2" onClick={() => setRoomId(roomId === r.roomId ? '' : r.roomId)}>
                    <Td><span className="font-medium">{r.name}</span> <span className="font-mono text-[12px] text-ink-3">{r.roomId}</span><div className="text-[13px] text-ink-3">{r.district} · {r.crops.map(crop).join(', ') || 'empty'}</div></Td>
                    <Td className="tabular">{num(r.kg)}</Td>
                    <Td className="tabular">{num(r.crates)}</Td>
                    <Td className="tabular">{num(r.batches)}</Td>
                    <Td className="w-40"><Meter value={r.fullnessPct} max={100} tone={r.fullnessPct > 95 ? 'critical' : r.fullnessPct > 80 ? 'warning' : 'brand'} /><div className="mt-1 text-[12px] text-ink-3">{r.fullnessPct}% of {r.capacityCrates} crates</div></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card>
          <CardHeader title="By crop" subtitle="Across all locations" />
          {!d ? <div className="p-4"><Skeleton className="h-24" /></div> : d.byCrop.length ? (
            <ul className="divide-y divide-line">
              {d.byCrop.map((c: any) => (
                <li key={c.crop} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm">
                  <button className="font-medium hover:underline" onClick={() => setCropFilter(cropFilter === c.crop ? '' : c.crop)}>{crop(c.crop)}</button>
                  <span className="tabular text-ink-2">{c.kg ? `${num(c.kg)} kg` : ''}{c.kg && c.crates ? ' + ' : ''}{c.crates ? `${num(c.crates)} crates` : ''} · {c.rooms} room{c.rooms === 1 ? '' : 's'}</span>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="Nothing stored" />}
        </Card>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented value={status} onChange={setStatus} options={[{ value: 'stored', label: 'In storage' }, { value: 'all', label: 'Including collected' }]} />
        <Select value={roomId} onChange={(e) => setRoomId(e.target.value)} className="w-56" aria-label="Room">
          <option value="">All rooms</option>
          {d?.byRoom.map((r: any) => <option key={r.roomId} value={r.roomId}>{r.name} ({r.roomId})</option>)}
        </Select>
        <Select value={cropFilter} onChange={(e) => setCropFilter(e.target.value)} className="w-40" aria-label="Crop">
          <option value="">All crops</option>
          {Object.entries(CROP).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Batch code, farmer, cooperative" className="w-64" />
        <label className="flex items-center gap-2 text-[13px] text-ink-2"><input type="checkbox" checked={requested} onChange={(e) => setRequested(e.target.checked)} /> Collection requested{d ? ` (${d.totals.toCollect})` : ''}</label>
      </div>

      <Card>
        {!d ? <div className="p-4"><Skeleton className="h-32" /></div> : !d.batches.length ? (
          <EmptyState icon={<Boxes className="size-6" />} title="No batches" body="Nothing matches these filters." />
        ) : (
          <Table>
            <thead><tr><Th>Batch</Th><Th>Farmer</Th><Th>Location</Th><Th>Harvested / stored</Th><Th>Freshness</Th><Th>Status</Th></tr></thead>
            <tbody>
              {d.batches.map((b: any) => (
                <tr key={b.id} className="hover:bg-surface-2">
                  <Td>
                    <Link href={`/stock/${b.id}`} className="font-medium hover:underline">{crop(b.crop)} · {qty(b.quantity, b.unit)}</Link>
                    <div className="flex items-center gap-1.5 font-mono text-[12px] text-ink-3"><QrCode className="size-3" />{b.code}</div>
                  </Td>
                  <Td>{b.farmerName}<div className="text-[13px] text-ink-3">{b.cooperativeName ?? 'No cooperative'}</div></Td>
                  <Td><Link className="hover:underline" href={`/rooms/${b.coldRoomId}`}>{b.roomName}</Link><div className="text-[13px] text-ink-3">{b.storageLocation || 'spot not recorded'}</div></Td>
                  <Td>{b.harvestDate ? date(`${b.harvestDate}T12:00:00Z`) : '–'}<div className="text-[13px] text-ink-3">stored {dateTime(b.storedAt)}</div></Td>
                  <Td><FreshnessBadge value={b.freshness} /></Td>
                  <Td><CollectionBadge status={b.collectionStatus} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {adding && <RegisterProduce rooms={d?.byRoom ?? []} onClose={() => setAdding(false)} onDone={inv.reload} />}
    </>
  );
}

function RegisterProduce({ rooms, onClose, onDone }: { rooms: any[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const farmers = useQuery<any[]>('farmers');
  const [form, setForm] = useState({ farmerId: '', coldRoomId: '', crop: 'carrot', quantity: '', unit: 'kg', harvestDate: today(), storageLocation: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<any>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const farmer = farmers.data?.find((f) => f.id === form.farmerId);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api('batches', { method: 'POST', body: { ...form, coldRoomId: form.coldRoomId || farmer?.coldRoomId, quantity: Number(form.quantity) } });
      setDone(r);
      toast('Produce registered');
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={done ? 'Produce registered' : 'Register produce'}
      footer={done ? <Link href={`/stock/${done.id}`}><Button variant="primary">Open the batch and print its label</Button></Link> : <><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} loading={busy} disabled={!form.farmerId || !form.quantity}>Register</Button></>}
    >
      {done ? (
        <p className="text-sm text-ink-2">Batch <span className="font-mono font-medium text-ink">{done.code}</span> is stored. Its QR label and charges are on the batch page.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><Field label="Farmer" htmlFor="rf"><Select id="rf" value={form.farmerId} onChange={set('farmerId')}><option value="">Choose the farmer…</option>{farmers.data?.map((f) => <option key={f.id} value={f.id}>{f.name} · {f.phone}{f.cooperativeName ? ` · ${f.cooperativeName}` : ''}</option>)}</Select></Field></div>
          <Field label="Cold room" htmlFor="rr" hint="Defaults to the farmer's room."><Select id="rr" value={form.coldRoomId || farmer?.coldRoomId || ''} onChange={set('coldRoomId')}>{rooms.map((r) => <option key={r.roomId} value={r.roomId}>{r.name} ({r.roomId})</option>)}</Select></Field>
          <Field label="Crop" htmlFor="rc"><Select id="rc" value={form.crop} onChange={set('crop')}>{Object.entries(CROP).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="Quantity" htmlFor="rq"><Input id="rq" inputMode="numeric" value={form.quantity} onChange={set('quantity')} /></Field>
          <Field label="Unit" htmlFor="ru"><Select id="ru" value={form.unit} onChange={set('unit')}>{UNITS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="Harvest date" htmlFor="rh"><Input id="rh" type="date" max={today()} value={form.harvestDate} onChange={set('harvestDate')} /></Field>
          <Field label="Spot in the room" htmlFor="rl" hint="E.g. Rack B, shelf 2"><Input id="rl" value={form.storageLocation} onChange={set('storageLocation')} /></Field>
          {error && <p className="text-sm text-critical-ink sm:col-span-2">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
