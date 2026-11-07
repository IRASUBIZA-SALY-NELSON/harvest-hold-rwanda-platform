'use client';

import { Printer } from 'lucide-react';
import Link from 'next/link';
import QRCode from 'qrcode';
import { use, useEffect, useState } from 'react';

import { useCan } from '@/components/admin-context';
import { CollectionBadge, PayDialog } from '@/components/domain/stock';
import { Badge, Button, Card, CardHeader, ErrorBox, Field, FreshnessBadge, Input, Modal, PageHeader, Select, Skeleton, StatTile, Table, Td, Textarea, Th, useToast } from '@/components/ui';
import { api, useQuery } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { crop, date, dateTime, duration, num, qty, rwf } from '@/lib/format';


const REASON: Record<string, string> = { checkin: 'Stored', collection: 'Collected', sale: 'Sold on the market', removed: 'Taken out' };

export default function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const can = useCan();
  const toast = useToast();
  const q = useQuery<any>(`batches/${id}`, { refreshMs: 60_000 });
  const [qr, setQr] = useState<string | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [listing, setListing] = useState(false);
  const [paying, setPaying] = useState<any>(null);
  const [spot, setSpot] = useState<string | null>(null);

  const traceUrl = q.data?.traceUrl as string | undefined;
  useEffect(() => {
    if (traceUrl) QRCode.toDataURL(traceUrl, { margin: 1, width: 320, errorCorrectionLevel: 'M' }).then(setQr, () => setQr(null));
  }, [traceUrl]);

  if (q.error) return <ErrorBox error={q.error} onRetry={q.reload} />;
  const d = q.data;
  if (!d) return <Skeleton className="h-96 rounded-xl" />;
  const b = d.batch;
  const stored = b.status === 'stored';
  const ch = d.charges;

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/stock" className="hover:underline">Inventory</Link>}
        title={<span className="flex flex-wrap items-center gap-3">{crop(b.crop)} · {qty(b.quantity, b.unit)} <CollectionBadge status={b.collectionStatus} /></span>}
        subtitle={<span className="font-mono">{b.code}</span>}
        actions={can('operations', 'operator') && stored && (
          <>
            <Button onClick={() => setListing(true)} disabled={!!d.listing && d.listing.status !== 'soldOut'}>List for sale</Button>
            <Button variant="primary" onClick={() => setCollecting(true)}>Record collection</Button>
          </>
        )}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Freshness" value={<FreshnessBadge value={d.conditions.freshness} />} sub={`${duration(d.conditions.minutesOutOfRange)} outside the safe range`} />
        <StatTile label="Storage so far" value={ch.rateSet ? rwf(ch.totalRwf) : 'No rate set'} sub={ch.rateSet ? `${ch.days} day${ch.days === 1 ? '' : 's'} · ${rwf(ch.rateRwf)} per ${b.unit} per day` : 'Set the rate in Settings'} />
        <StatTile label="Still to pay" value={ch.rateSet ? rwf(ch.dueRwf) : '–'} sub={`${rwf(ch.collectedRwf)} on collected produce`} tone={ch.dueRwf > 0 ? 'warning' : undefined} />
        <StatTile label="Data" value={d.conditions.dataSource === 'real' ? 'Real sensors' : d.conditions.dataSource === 'none' ? 'None' : d.conditions.dataSource === 'simulated' ? 'Simulated' : 'Mixed'} sub={`${num(d.conditions.samples)} readings`} tone={d.conditions.simulatedSamples ? 'warning' : undefined} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Where it came from and where it is" />
            <dl className="grid gap-x-6 gap-y-3 p-5 text-sm sm:grid-cols-2">
              <Item k="Farmer">{d.farmer.name} · {d.farmer.phone}</Item>
              <Item k="Cooperative">{d.cooperative?.name ?? '–'}</Item>
              <Item k="Harvested">{b.harvestDate ? date(`${b.harvestDate}T12:00:00Z`) : '–'}</Item>
              <Item k="Stored">{dateTime(b.storedAt)} by {b.registeredBy ?? '–'}</Item>
              <Item k="Cold room"><Link className="hover:underline" href={`/rooms/${d.coldRoom.id}`}>{d.coldRoom.name}</Link> <span className="font-mono text-[12px] text-ink-3">{d.coldRoom.id}</span> · {d.coldRoom.district}</Item>
              <Item k="Spot in the room">
                {spot === null ? <>{b.storageLocation || '–'} {can('operations', 'operator') && stored && <button className="ml-2 text-[13px] text-brand-ink hover:underline" onClick={() => setSpot(b.storageLocation)}>Move</button>}</> : (
                  <span className="flex items-center gap-2"><Input value={spot} onChange={(e) => setSpot(e.target.value)} className="h-8 w-40" />
                    <Button size="sm" variant="primary" onClick={async () => { try { await api(`batches/${b.id}`, { method: 'PATCH', body: { storageLocation: spot } }); toast('Moved'); setSpot(null); await q.reload(); } catch (e) { toast(errorMessage(e), 'critical'); } }}>Save</Button></span>
                )}
              </Item>
              <Item k="Quantity">{qty(b.initialQuantity, b.unit)} stored, {qty(b.quantity, b.unit)} left</Item>
              <Item k="Collection requested">{b.collectionRequestedAt ? dateTime(b.collectionRequestedAt) : '–'}</Item>
            </dl>
          </Card>

          <Card>
            <CardHeader title="Storage history" subtitle="Everything that went in and out" />
            <Table>
              <thead><tr><Th>When</Th><Th>What</Th><Th>Who</Th><Th align="right">Charge</Th><Th>Payment</Th></tr></thead>
              <tbody>
                {d.history.movements.map((m: any) => {
                  const c = d.history.collections.find((x: any) => x.collectedAt === m.at && m.kind === 'out');
                  return (
                    <tr key={m.id}>
                      <Td>{dateTime(m.at)}</Td>
                      <Td>{m.kind === 'in' ? '＋' : '−'} {REASON[m.reason] ?? m.reason}: {qty(m.quantity, m.unit)}{m.note ? <div className="text-[13px] text-ink-3">{m.note}</div> : null}</Td>
                      <Td>{m.by ?? '–'}</Td>
                      <Td align="right">{c ? (c.chargeRwf === null ? 'no rate' : `${rwf(c.chargeRwf)} (${c.days} d)`) : ''}</Td>
                      <Td>{c ? (c.paymentStatus === 'unpaid' ? (can('operations', 'operator') ? <Button size="sm" onClick={() => setPaying(c)}>Record payment</Button> : <Badge tone="warning">Unpaid</Badge>) : <Badge tone="good">{c.paymentStatus === 'waived' ? 'Waived' : `Paid · ${c.paymentMethod}`}</Badge>) : ''}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>
        </div>

        <Card className="h-fit print:border-0 print:shadow-none">
          <CardHeader title="QR label" subtitle="Scan to see this batch's record" actions={<Button size="sm" icon={<Printer className="size-4" />} onClick={() => window.print()}>Print</Button>} />
          <div className="flex flex-col items-center gap-2 p-5">
            {qr ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={qr} alt={`QR code for batch ${b.code}`} className="size-56 rounded-lg border border-line bg-white p-2" /> : <Skeleton className="size-56" />}
            <div className="font-mono text-base font-semibold">{b.code}</div>
            <div className="text-center text-[13px] text-ink-3">{crop(b.crop)} · {d.farmer.name}<br />{d.coldRoom.name} · harvested {b.harvestDate ? date(`${b.harvestDate}T12:00:00Z`) : '–'}</div>
            <a href={d.traceUrl} target="_blank" rel="noreferrer" className="text-[13px] text-brand-ink hover:underline print:hidden">Open the public page</a>
          </div>
        </Card>
      </div>

      {collecting && <CollectDialog batch={b} onClose={() => setCollecting(false)} onDone={q.reload} />}
      {listing && <ListDialog batch={b} onClose={() => setListing(false)} onDone={q.reload} />}
      {paying && <PayDialog collection={paying} onClose={() => setPaying(null)} onDone={q.reload} />}
    </>
  );
}

function Item({ k, children }: { k: string; children: React.ReactNode }) {
  return <div><dt className="text-[12px] font-medium uppercase tracking-wide text-ink-3">{k}</dt><dd className="mt-0.5 text-ink">{children}</dd></div>;
}

function CollectDialog({ batch, onClose, onDone }: { batch: any; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [all, setAll] = useState(true);
  const [quantity, setQuantity] = useState('');
  const [who, setWho] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<any>(`batches/${batch.id}/collect`, { method: 'POST', body: { all, quantity: Number(quantity), collectedBy: who, note } });
      toast(r.chargeRwf === null ? 'Collection recorded (no storage rate set yet)' : `Collection recorded: storage ${rwf(r.chargeRwf)}`);
      onDone();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="Record collection" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} loading={busy} disabled={!who.trim() || (!all && !quantity)}>Record collection</Button></>}>
      <div className="space-y-4">
        <p className="text-sm text-ink-2">The storage charge is worked out per day (the day it came in and the day it leaves both count) and fixed now.</p>
        <label className="flex items-center gap-2 text-sm"><input type="radio" checked={all} onChange={() => setAll(true)} /> All of it: {qty(batch.quantity, batch.unit)}</label>
        <label className="flex items-center gap-2 text-sm"><input type="radio" checked={!all} onChange={() => setAll(false)} /> Part of it</label>
        {!all && <Field label={`Quantity (${batch.unit})`} htmlFor="cq"><Input id="cq" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></Field>}
        <Field label="Collected by" htmlFor="cw" hint="The person who takes the produce away."><Input id="cw" value={who} onChange={(e) => setWho(e.target.value)} /></Field>
        <Field label="Note" htmlFor="cn"><Textarea id="cn" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {error && <p className="text-sm text-critical-ink">{error}</p>}
      </div>
    </Modal>
  );
}

function ListDialog({ batch, onClose, onDone }: { batch: any; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [quantity, setQuantity] = useState(String(batch.quantity));
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`batches/${batch.id}/list`, { method: 'POST', body: { quantity: Number(quantity), pricePerUnit: Number(price) } });
      toast('Listed for buyers');
      onDone();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="List for sale" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} loading={busy} disabled={!quantity || !price}>List it</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={`Quantity (${batch.unit})`} htmlFor="lq"><Input id="lq" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></Field>
        <Field label={`Price per ${batch.unit} (RWF)`} htmlFor="lp"><Input id="lp" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
        {error && <p className="text-sm text-critical-ink sm:col-span-2">{error}</p>}
      </div>
    </Modal>
  );
}
