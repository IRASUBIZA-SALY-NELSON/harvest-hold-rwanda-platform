'use client';

import { useState } from 'react';

import { useMe } from '@/components/admin-context';
import { Button, Card, CardHeader, EmptyState, ErrorBox, Field, Input, PageHeader, Select, Skeleton, Table, Td, Th, useToast } from '@/components/ui';
import { api, useQuery } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { CROP, crop } from '@/lib/format';

export default function SettingsPage() {
  const settings = useQuery<{ storageRates: { kgPerDay: number | null; cratePerDay: number | null } }>('settings');
  return (
    <>
      <PageHeader title="Settings" subtitle="System-wide settings. Only the Super Admin can change them; every change is kept in the audit trail." />
      {settings.error && <ErrorBox error={settings.error} onRetry={settings.reload} />}
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader title="Storage price: the default" subtitle="Charge = quantity (kg) × price per kg per day × number of days. The day produce comes in and the day it leaves both count. This price is used when nothing more specific is set below or in a room's own Settings tab." />
          {!settings.data ? <div className="p-5"><Skeleton className="h-24" /></div> : <RatesForm rates={settings.data.storageRates} onSaved={settings.reload} />}
        </Card>
        <PricesCard />
        <Card>
          <CardHeader title="How the controllers connect" />
          <div className="space-y-3 p-5 text-sm text-ink-2">
            <p>Every cold room talks to the platform over <strong className="text-ink">HTTPS</strong>. MQTT (a second, faster road) is built in but switched off for now; it can be switched on later when there are more rooms.</p>
            <p className="text-[13px] text-ink-3">A room keeps cooling by itself whatever the link does.</p>
          </div>
        </Card>
      </div>
    </>
  );
}

/** Mounted once the rates are loaded, so the fields start from what is saved. */
function RatesForm({ rates, onSaved }: { rates: { kgPerDay: number | null; cratePerDay: number | null }; onSaved: () => void }) {
  const me = useMe();
  const toast = useToast();
  const [kg, setKg] = useState(rates.kgPerDay === null ? '' : String(rates.kgPerDay));
  const [crate, setCrate] = useState(rates.cratePerDay === null ? '' : String(rates.cratePerDay));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boss = me.role === 'superadmin';

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('settings', { method: 'PUT', body: { storageRates: { kgPerDay: kg === '' ? null : Number(kg), cratePerDay: crate === '' ? null : Number(crate) } } });
      toast('Storage rates saved');
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 p-5 sm:grid-cols-2">
      <Field label="RWF per kg per day" htmlFor="rk" hint="Empty = no rate set yet"><Input id="rk" inputMode="numeric" value={kg} onChange={(e) => setKg(e.target.value)} disabled={!boss} /></Field>
      <Field label="RWF per crate per day" htmlFor="rc" hint="Empty = no rate set yet"><Input id="rc" inputMode="numeric" value={crate} onChange={(e) => setCrate(e.target.value)} disabled={!boss} /></Field>
      {error && <p className="text-sm text-critical-ink sm:col-span-2">{error}</p>}
      {boss ? <div className="sm:col-span-2"><Button variant="primary" onClick={save} loading={busy}>Save rates</Button></div> : <p className="text-[13px] text-ink-3 sm:col-span-2">Ask the Super Admin to change the rates.</p>}
    </div>
  );
}

/** Prices for a crop, in every room or in one room. The most specific price wins. */
function PricesCard() {
  const me = useMe();
  const toast = useToast();
  const prices = useQuery<any>('prices');
  const [form, setForm] = useState({ crop: 'carrot', roomId: '', kgPerDay: '', cratePerDay: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boss = me.role === 'superadmin';
  const d = prices.data;
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('prices', { method: 'PUT', body: { crop: form.crop, roomId: form.roomId || undefined, kgPerDay: form.kgPerDay === '' ? null : Number(form.kgPerDay), cratePerDay: form.cratePerDay === '' ? null : Number(form.cratePerDay) } });
      toast('Price saved');
      setForm((f) => ({ ...f, kgPerDay: '', cratePerDay: '' }));
      await prices.reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="xl:col-span-2">
      <CardHeader title="Prices by crop and cold room" subtitle="Most specific first: this crop in this room, then this crop in every room, then the room's own price, then the default above." />
      {!d ? <div className="p-5"><Skeleton className="h-24" /></div> : (
        <>
          {d.crops.length ? (
            <Table>
              <thead><tr><Th>Crop</Th><Th>Where</Th><Th align="right">RWF per kg per day</Th><Th align="right">RWF per crate per day</Th><Th /></tr></thead>
              <tbody>
                {d.crops.map((p: any) => (
                  <tr key={p.id}>
                    <Td className="font-medium">{crop(p.crop)}</Td>
                    <Td>{p.roomId ? <>{p.roomName} <span className="font-mono text-[12px] text-ink-3">{p.roomId}</span></> : 'Every room'}</Td>
                    <Td align="right">{p.kgPerDay ?? '–'}</Td>
                    <Td align="right">{p.cratePerDay ?? '–'}</Td>
                    <Td align="right">{boss && <Button size="sm" variant="ghost" onClick={async () => { await api(`prices/${p.id}`, { method: 'DELETE' }); toast('Price removed'); await prices.reload(); }}>Remove</Button>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : <EmptyState title="No crop prices yet" body="Until you set one, every crop uses the room's price or the default." />}
          {d.rooms.some((r: any) => r.kgPerDay !== null || r.cratePerDay !== null) && (
            <div className="border-t border-line px-5 py-3 text-[13px] text-ink-2">
              Room prices (set in each room’s Settings): {d.rooms.filter((r: any) => r.kgPerDay !== null || r.cratePerDay !== null).map((r: any) => `${r.name} ${r.kgPerDay ?? '–'} per kg`).join(' · ')}
            </div>
          )}
          {boss ? (
            <div className="grid gap-4 border-t border-line p-5 sm:grid-cols-5">
              <Field label="Crop" htmlFor="pc"><Select id="pc" value={form.crop} onChange={set('crop')}>{Object.entries(CROP).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
              <Field label="Cold room" htmlFor="pr"><Select id="pr" value={form.roomId} onChange={set('roomId')}><option value="">Every room</option>{d.rooms.map((r: any) => <option key={r.roomId} value={r.roomId}>{r.name} ({r.roomId})</option>)}</Select></Field>
              <Field label="RWF per kg per day" htmlFor="pk"><Input id="pk" inputMode="numeric" value={form.kgPerDay} onChange={set('kgPerDay')} /></Field>
              <Field label="RWF per crate per day" htmlFor="pq"><Input id="pq" inputMode="numeric" value={form.cratePerDay} onChange={set('cratePerDay')} /></Field>
              <div className="flex items-end"><Button variant="primary" onClick={save} loading={busy} disabled={!form.kgPerDay && !form.cratePerDay}>Save price</Button></div>
              {error && <p className="text-sm text-critical-ink sm:col-span-5">{error}</p>}
            </div>
          ) : <p className="border-t border-line px-5 py-3 text-[13px] text-ink-3">Only the Super Admin can change prices.</p>}
        </>
      )}
    </Card>
  );
}
