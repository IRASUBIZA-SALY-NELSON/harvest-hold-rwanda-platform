'use client';

import { Building2, Plus, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { useCan } from '@/components/admin-context';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Input, Modal, PageHeader, SecretBox, Select, Skeleton, Table, Tabs, Td, Th, useToast } from '@/components/ui';
import { api, useQuery } from '@/lib/api';
import { DISTRICTS } from '@/lib/districts';
import { errorMessage } from '@/lib/errors';
import { dateTime, num } from '@/lib/format';

export default function FarmersPage() {
  const can = useCan();
  const me = can('support', 'operations', 'operator');
  const [tab, setTab] = useState<'farmers' | 'cooperatives'>('farmers');
  const [q, setQ] = useState('');
  const [roomId, setRoomId] = useState('');
  const [coopId, setCoopId] = useState('');
  const params = new URLSearchParams();
  if (q.trim()) params.set('q', q.trim());
  if (roomId) params.set('roomId', roomId);
  if (coopId) params.set('cooperativeId', coopId);
  const farmers = useQuery<any[]>(`farmers?${params}`);
  const coops = useQuery<any[]>('cooperatives');
  const rooms = useQuery<any[]>('rooms');
  const [addFarmer, setAddFarmer] = useState(false);
  const [addCoop, setAddCoop] = useState(false);

  return (
    <>
      <PageHeader
        title="Farmers & cooperatives"
        subtitle="Register the farmers who store at your cold rooms, and the cooperatives they belong to."
        actions={me && (
          <>
            <Button icon={<Building2 className="size-4" />} onClick={() => setAddCoop(true)}>Register cooperative</Button>
            <Button variant="primary" icon={<UserPlus className="size-4" />} onClick={() => setAddFarmer(true)}>Register farmer</Button>
          </>
        )}
      />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'farmers', label: 'Farmers', count: farmers.data?.length }, { value: 'cooperatives', label: 'Cooperatives', count: coops.data?.length }]} />
      <div className="mt-5">
        {tab === 'farmers' ? (
          <>
            <div className="mb-4 flex flex-wrap gap-3">
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or phone" className="w-56" />
              <Select value={roomId} onChange={(e) => setRoomId(e.target.value)} className="w-56" aria-label="Room"><option value="">All rooms</option>{rooms.data?.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.id})</option>)}</Select>
              <Select value={coopId} onChange={(e) => setCoopId(e.target.value)} className="w-56" aria-label="Cooperative"><option value="">All cooperatives</option>{coops.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
            </div>
            {farmers.error && <ErrorBox error={farmers.error} onRetry={farmers.reload} />}
            <Card>
              {!farmers.data ? <div className="p-4"><Skeleton className="h-32" /></div> : !farmers.data.length ? <EmptyState title="No farmers" body="Register the first farmer of this room." /> : (
                <Table>
                  <thead><tr><Th>Farmer</Th><Th>Cold room</Th><Th>Cooperative</Th><Th>Stored batches</Th><Th>Registered</Th></tr></thead>
                  <tbody>
                    {farmers.data.map((f) => (
                      <tr key={f.id}>
                        <Td>{can('support') ? <Link className="font-medium hover:underline" href={`/people/${f.id}`}>{f.name}</Link> : <span className="font-medium">{f.name}</span>}{f.status === 'suspended' && <Badge tone="warning" className="ml-2">Suspended</Badge>}<div className="text-[13px] text-ink-3">{f.phone} · {f.district}</div></Td>
                        <Td><Link className="hover:underline" href={`/rooms/${f.coldRoomId}`}>{f.roomName}</Link> <span className="font-mono text-[12px] text-ink-3">{f.coldRoomId}</span></Td>
                        <Td>{f.cooperativeName ?? '–'}</Td>
                        <Td className="tabular">{num(f.storedBatches)}</Td>
                        <Td>{dateTime(f.createdAt)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          </>
        ) : (
          <Card>
            {!coops.data ? <div className="p-4"><Skeleton className="h-32" /></div> : !coops.data.length ? <EmptyState icon={<Building2 className="size-6" />} title="No cooperatives yet" /> : (
              <Table>
                <thead><tr><Th>Cooperative</Th><Th>Where</Th><Th>Contact</Th><Th>Farmers</Th><Th>Batches in storage</Th></tr></thead>
                <tbody>
                  {coops.data.map((c) => (
                    <tr key={c.id}>
                      <Td><span className="font-medium">{c.name}</span></Td>
                      <Td>{c.sector ? `${c.sector}, ` : ''}{c.district}</Td>
                      <Td>{c.contactName || '–'}<div className="text-[13px] text-ink-3">{c.contactPhone}</div></Td>
                      <Td className="tabular">{num(c.farmers)}</Td>
                      <Td className="tabular">{num(c.storedBatches)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        )}
      </div>
      {addFarmer && <FarmerDialog rooms={rooms.data ?? []} coops={coops.data ?? []} onClose={() => setAddFarmer(false)} onDone={farmers.reload} />}
      {addCoop && <CoopDialog onClose={() => setAddCoop(false)} onDone={coops.reload} />}
    </>
  );
}

function FarmerDialog({ rooms, coops, onClose, onDone }: { rooms: any[]; coops: any[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', phone: '', district: 'Musanze', coldRoomId: rooms[0]?.id ?? '', cooperativeId: '', lang: 'rw' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ temporaryPin: string }>('farmers', { method: 'POST', body: { ...form, cooperativeId: form.cooperativeId || undefined } });
      setPin(r.temporaryPin);
      toast('Farmer registered');
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={pin ? 'Farmer registered' : 'Register farmer'} footer={pin ? <Button variant="primary" onClick={onClose}>Done</Button> : <><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} loading={busy} disabled={!form.name || !form.phone || !form.coldRoomId}>Register</Button></>}>
      {pin ? (
        <div className="space-y-3 text-sm text-ink-2"><p>Give the farmer this PIN. They sign in to the app with their phone number and this PIN.</p><SecretBox label={`PIN for ${form.name}`} value={pin} note="Shown once." /></div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" htmlFor="fn"><Input id="fn" value={form.name} onChange={set('name')} /></Field>
          <Field label="Phone number" htmlFor="fp" hint="078 812 3456"><Input id="fp" inputMode="tel" value={form.phone} onChange={set('phone')} /></Field>
          <Field label="District" htmlFor="fd"><Select id="fd" value={form.district} onChange={set('district')}>{DISTRICTS.map((x) => <option key={x}>{x}</option>)}</Select></Field>
          <Field label="Cold room" htmlFor="fr"><Select id="fr" value={form.coldRoomId} onChange={set('coldRoomId')}>{rooms.filter((r) => r.status !== 'retired').map((r) => <option key={r.id} value={r.id}>{r.name} ({r.id})</option>)}</Select></Field>
          <Field label="Cooperative" htmlFor="fc"><Select id="fc" value={form.cooperativeId} onChange={set('cooperativeId')}><option value="">None</option>{coops.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="App language" htmlFor="fl"><Select id="fl" value={form.lang} onChange={set('lang')}><option value="rw">Kinyarwanda</option><option value="en">English</option><option value="fr">Français</option></Select></Field>
          {error && <p className="text-sm text-critical-ink sm:col-span-2">{error}</p>}
        </div>
      )}
    </Modal>
  );
}

function CoopDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', district: 'Musanze', sector: '', contactName: '', contactPhone: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('cooperatives', { method: 'POST', body: form });
      toast('Cooperative registered');
      onDone();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="Register cooperative" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={<Plus className="size-4" />} onClick={save} loading={busy} disabled={!form.name}>Register</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Name" htmlFor="cn"><Input id="cn" value={form.name} onChange={set('name')} /></Field></div>
        <Field label="District" htmlFor="cd"><Select id="cd" value={form.district} onChange={set('district')}>{DISTRICTS.map((x) => <option key={x}>{x}</option>)}</Select></Field>
        <Field label="Sector" htmlFor="cs"><Input id="cs" value={form.sector} onChange={set('sector')} /></Field>
        <Field label="Contact person" htmlFor="cc"><Input id="cc" value={form.contactName} onChange={set('contactName')} /></Field>
        <Field label="Contact phone" htmlFor="cp"><Input id="cp" inputMode="tel" value={form.contactPhone} onChange={set('contactPhone')} /></Field>
        {error && <p className="text-sm text-critical-ink sm:col-span-2">{error}</p>}
      </div>
    </Modal>
  );
}
