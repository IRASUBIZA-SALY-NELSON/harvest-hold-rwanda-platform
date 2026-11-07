'use client';

import { ClipboardCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { useCan } from '@/components/admin-context';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, Segmented, Select, Skeleton, Table, Td, Textarea, Th, useToast } from '@/components/ui';
import { api, useQuery } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { ago, crop, dateTime, qty } from '@/lib/format';

const today = () => new Date(Date.now() + 2 * 3_600_000).toISOString().slice(0, 10);

export default function RequestsPage() {
  const can = useCan();
  const [status, setStatus] = useState<'pending' | 'all'>('pending');
  const list = useQuery<any[]>(`storage-requests?status=${status}`, { refreshMs: 30_000 });
  const [accepting, setAccepting] = useState<any>(null);
  const [declining, setDeclining] = useState<any>(null);
  const mayHandle = can('operations', 'operator');

  return (
    <>
      <PageHeader
        title="Storage requests"
        subtitle="Farmers ask to store produce. When it arrives, weigh and inspect it, confirm what you really received, and register it: the farmer then sees the confirmed quantity."
        actions={<Segmented value={status} onChange={setStatus} options={[{ value: 'pending', label: 'Waiting' }, { value: 'all', label: 'All requests' }]} />}
      />
      {list.error && <ErrorBox error={list.error} onRetry={list.reload} />}
      <Card>
        {!list.data ? <div className="p-4"><Skeleton className="h-32" /></div> : !list.data.length ? (
          <EmptyState icon={<ClipboardCheck className="size-6" />} title={status === 'pending' ? 'No requests waiting' : 'No requests yet'} body="New requests from farmers appear here." />
        ) : (
          <Table>
            <thead><tr><Th>Farmer</Th><Th>Asked to store</Th><Th>Room</Th><Th>Status</Th><Th /></tr></thead>
            <tbody>
              {list.data.map((r) => (
                <tr key={r.id}>
                  <Td><span className="font-medium">{r.farmerName}</span><div className="text-[13px] text-ink-3">{r.farmerPhone}{r.cooperativeName ? ` · ${r.cooperativeName}` : ''}</div></Td>
                  <Td>{crop(r.crop)} · about {qty(r.estimatedQuantity, r.unit)}<div className="text-[13px] text-ink-3">{r.note || 'no note'} · asked {ago(r.createdAt)}</div></Td>
                  <Td>{r.roomName} <span className="font-mono text-[12px] text-ink-3">{r.coldRoomId}</span></Td>
                  <Td>
                    {r.status === 'pending' ? <Badge tone="warning">Waiting</Badge>
                      : r.status === 'accepted' ? <><Badge tone="good">Registered</Badge><div className="mt-1 text-[13px] text-ink-3">{qty(r.confirmedQuantity, r.unit)} confirmed by {r.handledBy} · <Link className="font-mono hover:underline" href={`/stock/${r.batchId}`}>{r.batchCode}</Link></div></>
                      : r.status === 'declined' ? <><Badge tone="critical">Declined</Badge><div className="mt-1 text-[13px] text-ink-3">{r.declineReason}</div></>
                      : <Badge>Cancelled</Badge>}
                    {r.handledAt && r.status !== 'pending' && <div className="text-[12px] text-ink-3">{dateTime(r.handledAt)}</div>}
                  </Td>
                  <Td align="right">
                    {r.status === 'pending' && mayHandle && (
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" onClick={() => setDeclining(r)}>Decline</Button>
                        <Button size="sm" variant="primary" onClick={() => setAccepting(r)}>Weigh and register</Button>
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {accepting && <AcceptDialog request={accepting} onClose={() => setAccepting(null)} onDone={list.reload} />}
      {declining && <DeclineDialog request={declining} onClose={() => setDeclining(null)} onDone={list.reload} />}
    </>
  );
}

function AcceptDialog({ request, onClose, onDone }: { request: any; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ quantity: String(request.estimatedQuantity), unit: request.unit, harvestDate: today(), storageLocation: '', inspectionNote: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<any>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      setDone(await api(`storage-requests/${request.id}/accept`, { method: 'POST', body: { ...form, quantity: Number(form.quantity) } }));
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
      title={done ? 'Registered' : `Weigh and register: ${request.farmerName}`}
      footer={done ? <Link href={`/stock/${done.id}`}><Button variant="primary">Open the batch and print its QR label</Button></Link> : <><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} loading={busy} disabled={!form.quantity}>Confirm and register</Button></>}
    >
      {done ? (
        <p className="text-sm text-ink-2">Batch <span className="font-mono font-medium text-ink">{done.code}</span>: {qty(done.quantity, done.unit)} confirmed (the farmer asked for about {qty(request.estimatedQuantity, request.unit)}). The farmer has been told.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <p className="text-sm text-ink-2 sm:col-span-2">{crop(request.crop)}: the farmer asked to store about {qty(request.estimatedQuantity, request.unit)}. Enter what you actually weighed.</p>
          <Field label="Confirmed quantity" htmlFor="aq"><Input id="aq" inputMode="numeric" value={form.quantity} onChange={set('quantity')} autoFocus /></Field>
          <Field label="Unit" htmlFor="au"><Select id="au" value={form.unit} onChange={set('unit')}><option value="kg">kilograms</option><option value="crate">crates</option></Select></Field>
          <Field label="Harvest date" htmlFor="ah"><Input id="ah" type="date" max={today()} value={form.harvestDate} onChange={set('harvestDate')} /></Field>
          <Field label="Spot in the room" htmlFor="al" hint="E.g. Rack B, shelf 2"><Input id="al" value={form.storageLocation} onChange={set('storageLocation')} /></Field>
          <div className="sm:col-span-2"><Field label="Inspection note" htmlFor="an" hint="E.g. 5 kg damaged, not accepted."><Textarea id="an" value={form.inspectionNote} onChange={set('inspectionNote')} /></Field></div>
          {error && <p className="text-sm text-critical-ink sm:col-span-2">{error}</p>}
        </div>
      )}
    </Modal>
  );
}

function DeclineDialog({ request, onClose, onDone }: { request: any; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`storage-requests/${request.id}/decline`, { method: 'POST', body: { reason } });
      toast('Request declined');
      onDone();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={`Decline ${request.farmerName}'s request?`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="danger" onClick={save} loading={busy} disabled={reason.trim().length < 5}>Decline</Button></>}>
      <div className="space-y-3">
        <Field label="Reason" htmlFor="dr" hint="The farmer sees this."><Textarea id="dr" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></Field>
        {error && <p className="text-sm text-critical-ink">{error}</p>}
      </div>
    </Modal>
  );
}
