'use client';

import { KeyRound, LockOpen, UserPlus } from 'lucide-react';
import { useState } from 'react';

import { useMe } from '@/components/admin-context';
import { ActionDialog, Badge, Button, Card, ErrorBox, Field, Input, Modal, PageHeader, SecretBox, Select, Skeleton, Table, Td, Th, useToast } from '@/components/ui';
import { api, useQuery } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { ago } from '@/lib/format';

const ROLES = [
  ['superadmin', 'Super Admin / CEO', 'Everything: all rooms, farmers, inventory, reports, users and settings.'],
  ['support', 'Support', 'Farmers and buyers: unlock, reset PIN, suspend. Incidents.'],
  ['operations', 'Operations', 'Cold rooms, controllers, firmware, crop profiles, incidents.'],
  ['market', 'Market', 'Listings, orders, certificates, photos.'],
  ['operator', 'Cold room operator', 'Only the rooms assigned to them: register produce, manage storage, record collections, control the room.'],
] as const;

export default function StaffPage() {
  const me = useMe();
  const staff = useQuery<any[]>('staff');
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [reset, setReset] = useState<any>(null);
  const [secret, setSecret] = useState<{ who: string; password: string } | null>(null);
  const [assigning, setAssigning] = useState<any>(null);
  const rooms = useQuery<any[]>('rooms');

  if (me.role !== 'superadmin') return <ErrorBox error={{ code: 'notAllowed' }} />;
  const update = async (id: string, body: object, msg: string) => {
    try {
      await api(`staff/${id}`, { method: 'PATCH', body });
      toast(msg);
      await staff.reload();
    } catch (e) {
      toast(errorMessage(e), 'critical');
    }
  };

  return (
    <>
      <PageHeader
        title="Staff"
        subtitle="Who can use this portal, and what each role can do. Each person signs in with their email and their own password."
        actions={<Button variant="primary" icon={<UserPlus className="size-4" />} onClick={() => setAdding(true)}>Add staff</Button>}
      />
      <div className="mb-6 grid gap-3 md:grid-cols-3 xl:grid-cols-5">
        {ROLES.map(([k, l, d]) => (
          <Card key={k} className="p-4"><div className="text-sm font-medium">{l}</div><div className="mt-1 text-[13px] text-ink-3">{d}</div></Card>
        ))}
      </div>
      {staff.error && <ErrorBox error={staff.error} onRetry={staff.reload} />}
      <Card>
        {!staff.data ? <div className="p-4"><Skeleton className="h-32" /></div> : (
          <Table>
            <thead><tr><Th>Person</Th><Th>Role</Th><Th>Security</Th><Th>Last sign-in</Th><Th>Access</Th><Th /></tr></thead>
            <tbody>
              {staff.data.map((a) => (
                <tr key={a.id}>
                  <Td><div className="font-medium">{a.name}{a.id === me.id && <span className="ml-1.5 text-[13px] text-ink-3">(you)</span>}</div><div className="text-[13px] text-ink-3">{a.email}</div></Td>
                  <Td>
                    <Select value={a.role} disabled={a.id === me.id} onChange={(e) => update(a.id, { role: e.target.value }, 'Role changed')} className="w-36">
                      {ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </Select>
                    {a.role === 'operator' && (
                      <div className="mt-1.5 text-[13px] text-ink-2">
                        {a.roomIds?.length ? a.roomIds.join(', ') : <span className="text-warning-ink">No rooms assigned</span>}
                        <button className="ml-2 text-brand-ink hover:underline" onClick={() => setAssigning(a)}>Assign rooms</button>
                      </div>
                    )}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {!a.locked && !a.mustChangePassword && <Badge tone="good">Password set</Badge>}
                      {a.locked && <Badge tone="critical">Locked</Badge>}
                      {a.mustChangePassword && <Badge>Temporary password</Badge>}
                    </div>
                  </Td>
                  <Td className="text-ink-2">{a.lastLoginAt ? ago(a.lastLoginAt) : 'never'}</Td>
                  <Td>{a.status === 'active' ? <Badge tone="good">Active</Badge> : <Badge tone="critical">Disabled</Badge>}</Td>
                  <Td align="right">
                    {a.id !== me.id && (
                      <div className="flex justify-end gap-1.5">
                        {a.locked && <Button size="sm" icon={<LockOpen className="size-3.5" />} onClick={async () => { await api(`staff/${a.id}/unlock`, { method: 'POST' }); toast('Unlocked'); await staff.reload(); }}>Unlock</Button>}
                        <Button size="sm" icon={<KeyRound className="size-3.5" />} onClick={() => setReset(a)}>Reset access</Button>
                        <Button size="sm" variant={a.status === 'active' ? 'danger' : 'secondary'} onClick={() => update(a.id, { status: a.status === 'active' ? 'disabled' : 'active' }, a.status === 'active' ? 'Disabled' : 'Enabled')}>
                          {a.status === 'active' ? 'Disable' : 'Enable'}
                        </Button>
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {assigning && <AssignRooms person={assigning} rooms={rooms.data ?? []} onClose={() => setAssigning(null)} onDone={staff.reload} />}
      <AddStaff rooms={rooms.data ?? []} open={adding} onClose={() => setAdding(false)} onCreated={(who, password) => { setSecret({ who, password }); void staff.reload(); }} />
      <ActionDialog
        open={!!reset}
        onClose={() => setReset(null)}
        title={reset ? `Reset ${reset.name}'s access?` : ''}
        description="For a forgotten password: they get a new temporary password to change at their next sign-in. All their sessions end."
        confirmLabel="Reset access"
        danger
        onConfirm={async () => {
          const r = await api<{ temporaryPassword: string }>(`staff/${reset.id}/reset-access`, { method: 'POST' });
          setSecret({ who: reset.email, password: r.temporaryPassword });
          await staff.reload();
        }}
      />
      <Modal open={!!secret} onClose={() => setSecret(null)} title="Temporary password" footer={<Button variant="primary" onClick={() => setSecret(null)}>Done</Button>}>
        {secret && <SecretBox label={`For ${secret.who}`} value={secret.password} note="Shown once. Give it to them in person or by phone, not by email. They must change it at first sign-in." />}
      </Modal>
    </>
  );
}

function RoomChecks({ rooms, value, onChange }: { rooms: any[]; value: string[]; onChange: (ids: string[]) => void }) {
  return (
    <div className="space-y-1.5">
      {rooms.filter((r) => r.status !== 'retired').map((r) => (
        <label key={r.id} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={value.includes(r.id)} onChange={(e) => onChange(e.target.checked ? [...value, r.id] : value.filter((x) => x !== r.id))} />
          {r.name} <span className="font-mono text-[12px] text-ink-3">{r.id}</span> <span className="text-ink-3">· {r.district}</span>
        </label>
      ))}
    </div>
  );
}

function AssignRooms({ person, rooms, onClose, onDone }: { person: any; rooms: any[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [ids, setIds] = useState<string[]>(person.roomIds ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`staff/${person.id}/rooms`, { method: 'PUT', body: { roomIds: ids } });
      toast('Rooms assigned');
      onDone();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title={`Rooms for ${person.name}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}>
      <div className="space-y-3">
        <p className="text-sm text-ink-2">The operator works in these rooms only: they see them, register produce in them, record collections and control them. The rooms stay the farmers’ and Harvest Hold’s.</p>
        <RoomChecks rooms={rooms} value={ids} onChange={setIds} />
        {error && <p className="text-sm text-critical-ink">{error}</p>}
      </div>
    </Modal>
  );
}

function AddStaff({ rooms, open, onClose, onCreated }: { rooms: any[]; open: boolean; onClose: () => void; onCreated: (who: string, password: string) => void }) {
  const [form, setForm] = useState({ name: '', email: '', role: 'support' });
  const [roomIds, setRoomIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ temporaryPassword: string }>('staff', { method: 'POST', body: { ...form, roomIds: form.role === 'operator' ? roomIds : undefined } });
      onCreated(form.email, r.temporaryPassword);
      setForm({ name: '', email: '', role: 'support' });
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Add staff" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Add</Button></>}>
      <div className="space-y-4">
        <Field label="Full name" htmlFor="sn"><Input id="sn" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Work email" htmlFor="se"><Input id="se" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Role" htmlFor="sr" hint={ROLES.find((r) => r[0] === form.role)?.[2]}>
          <Select id="sr" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        </Field>
        {form.role === 'operator' && <Field label="Rooms they work in" htmlFor="srooms"><RoomChecks rooms={rooms} value={roomIds} onChange={setRoomIds} /></Field>}
        {form.role === 'operator' && <Field label="Rooms they work in" htmlFor="srooms"><RoomChecks rooms={rooms} value={roomIds} onChange={setRoomIds} /></Field>}
        {error && <p className="text-sm text-critical-ink">{error}</p>}
      </div>
    </Modal>
  );
}
