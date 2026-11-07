'use client';

import { Plus, Thermometer } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { useCan } from '@/components/admin-context';
import type { RoomCardData } from '@/components/domain/room-card';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, HealthRing, Input, Modal, PageHeader, SecretBox, Select, Skeleton, Table, Td, Textarea, Th, useToast } from '@/components/ui';
import { api, useQuery } from '@/lib/api';
import { DISTRICTS } from '@/lib/districts';
import { errorMessage } from '@/lib/errors';
import { ago, crop, num, temp } from '@/lib/format';
import { useLiveEvents } from '@/lib/live';

type Room = RoomCardData & { lastUploadAt: string | null; firmwareChannel: string; farmers: number };

export default function RoomsPage() {
  const rooms = useQuery<Room[]>('rooms', { refreshMs: 60_000 });
  const can = useCan();
  const [adding, setAdding] = useState(false);

  useLiveEvents((e) => {
    if (e.type === 'reading') rooms.setData((d) => d?.map((r) => (r.id === e.roomId ? { ...r, reading: e.reading } : r)));
    if (e.type === 'incident') void rooms.reload();
  });

  return (
    <>
      <PageHeader
        title="Cold rooms"
        subtitle="Each room and its controller: live conditions, health, firmware and who stores there."
        actions={can('operations') && <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Add cold room</Button>}
      />
      {rooms.error && <ErrorBox error={rooms.error} onRetry={rooms.reload} />}
      <Card>
        {!rooms.data ? (
          <div className="space-y-2 p-4">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : !rooms.data.length ? (
          <EmptyState icon={<Thermometer className="size-6" />} title="No cold rooms yet" body="Add the first room to get its controller's token." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Room</Th>
                <Th>Health</Th>
                <Th align="right">Chamber</Th>
                <Th>Cooling</Th>
                <Th align="right">Stored</Th>
                <Th>Controller</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rooms.data.map((r) => {
                const out = r.reading?.chamber !== null && r.reading && r.safeMin !== undefined && (r.reading.chamber < r.safeMin || r.reading.chamber > r.safeMax!);
                return (
                  <tr key={r.id} className="hover:bg-surface-2">
                    <Td>
                      <Link href={`/rooms/${r.id}`} className="font-medium text-ink hover:underline">{r.name}</Link> <span className="rounded-md bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] text-ink-2">{r.id}</span>{r.reading?.simulated && <Badge tone="warning" className="ml-1.5">Simulated</Badge>}
                      <div className="text-[13px] text-ink-3">{r.sector}, {r.district} · {crop(r.crop)} · {r.farmers} farmer{r.farmers === 1 ? '' : 's'}</div>
                    </Td>
                    <Td><HealthRing score={r.health?.score} size={36} /></Td>
                    <Td align="right">
                      <span className={out ? 'font-medium text-warning-ink' : ''}>{temp(r.reading?.chamber)}</span>
                      <div className="text-[13px] text-ink-3">{r.safeMin}–{r.safeMax}°C</div>
                    </Td>
                    <Td>
                      {r.coolingType === 'peltier' ? (
                        <>
                          <div>Peltier · {r.reading?.coolerDuty ?? '–'}%{r.reading?.coolerPower ? ` · ${r.reading.coolerPower} W` : ''}</div>
                          <div className="text-[13px] text-ink-3">Hot side {temp(r.reading?.hotSide)}{r.reading?.battery !== null && r.reading?.battery !== undefined ? ` · battery ${r.reading.battery}%` : ''}</div>
                        </>
                      ) : (
                        <>
                          <div>Ice bank</div>
                          <div className="text-[13px] text-ink-3">Ice {temp(r.reading?.iceBank)}</div>
                        </>
                      )}
                    </Td>
                    <Td align="right">
                      {num(r.storedCrates)}/{num(r.capacityCrates)}
                      <div className="text-[13px] text-ink-3">crates</div>
                    </Td>
                    <Td>
                      <div>v{r.firmwareVersion ?? '?'} <span className="text-ink-3">· {r.firmwareChannel}</span></div>
                      <div className="text-[13px] text-ink-3">{r.reading ? `seen ${ago(r.reading.at)}` : 'never seen'}{r.lastUploadVia === 'mqtt' ? ' · via MQTT' : ''}</div>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {r.status !== 'active' ? <Badge tone="warning">{r.status}</Badge> : r.reading?.online ? <Badge tone="good">Online</Badge> : <Badge tone="critical">Offline</Badge>}
                        {r.openIncidents > 0 && <Badge tone="critical">{r.openIncidents} incident{r.openIncidents > 1 ? 's' : ''}</Badge>}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      <AddRoom open={adding} onClose={() => setAdding(false)} onCreated={() => void rooms.reload()} />
    </>
  );
}

function AddRoom({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const crops = useQuery<{ crop: string }[]>(open ? 'crops' : null);
  const toast = useToast();
  const [form, setForm] = useState({ name: '', district: 'Musanze', sector: '', crop: 'carrot', capacityCrates: '12', coolingType: 'peltier', latitude: '', longitude: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; deviceToken: string } | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: string; deviceToken: string }>('rooms', { method: 'POST', body: { ...form, capacityCrates: Number(form.capacityCrates), latitude: form.latitude || null, longitude: form.longitude || null } });
      setCreated(r);
      onCreated();
      toast(`${form.name} created`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    setCreated(null);
    setForm((f) => ({ ...f, name: '', sector: '', notes: '' }));
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={created ? 'Cold room created' : 'Add cold room'}
      wide
      footer={
        created ? (
          <Button variant="primary" onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button variant="primary" onClick={submit} loading={busy}>Create room</Button>
          </>
        )
      }
    >
      {created ? (
        <div className="space-y-4 text-sm text-ink-2">
          <p>Put this token in the controller&apos;s <code className="rounded bg-surface-3 px-1">config.h</code> as <code className="rounded bg-surface-3 px-1">DEVICE_TOKEN</code>, with <code className="rounded bg-surface-3 px-1">DEVICE_ID &quot;{created.id}&quot;</code>.</p>
          <SecretBox label="Controller token" value={created.deviceToken} note="Shown only once: the server keeps only a fingerprint of it. If it is lost, issue a new one from the room's settings." />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="rn"><Input id="rn" value={form.name} onChange={set('name')} placeholder="Mukamira Cold Hub" /></Field>
          <Field label="Main crop" htmlFor="rc" hint="Sets the room's temperature and humidity rules.">
            <Select id="rc" value={form.crop} onChange={set('crop')}>
              {(crops.data ?? [{ crop: 'carrot' }]).map((c) => <option key={c.crop} value={c.crop}>{crop(c.crop)}</option>)}
            </Select>
          </Field>
          <Field label="District" htmlFor="rd"><Select id="rd" value={form.district} onChange={set('district')}>{DISTRICTS.map((d) => <option key={d}>{d}</option>)}</Select></Field>
          <Field label="Sector" htmlFor="rs"><Input id="rs" value={form.sector} onChange={set('sector')} /></Field>
          <Field label="Cooling" htmlFor="rt">
            <Select id="rt" value={form.coolingType} onChange={set('coolingType')}>
              <option value="peltier">Peltier (prototype)</option>
              <option value="ice_bank">Ice bank (full size)</option>
            </Select>
          </Field>
          <Field label="Capacity (crates)" htmlFor="rcap"><Input id="rcap" inputMode="numeric" value={form.capacityCrates} onChange={set('capacityCrates')} /></Field>
          <Field label="Latitude" htmlFor="rlat" hint="Optional, e.g. −1.4317"><Input id="rlat" value={form.latitude} onChange={set('latitude')} /></Field>
          <Field label="Longitude" htmlFor="rlng" hint="Optional, e.g. 29.5936"><Input id="rlng" value={form.longitude} onChange={set('longitude')} /></Field>
          <div className="sm:col-span-2"><Field label="Notes" htmlFor="rno"><Textarea id="rno" value={form.notes} onChange={set('notes')} placeholder="Site contact, access, installation details…" /></Field></div>
          {error && <p className="text-sm text-critical-ink sm:col-span-2">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
