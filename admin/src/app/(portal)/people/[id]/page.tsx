'use client';

import { KeyRound, LockOpen, LogOut, PauseCircle, PlayCircle } from 'lucide-react';
import Link from 'next/link';
import { use, useState } from 'react';

import { useCan } from '@/components/admin-context';
import { AuditList } from '@/components/domain/audit-list';
import { Avatar, PersonStatus } from '@/components/domain/people';
import {
  ActionDialog,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorBox,
  FreshnessBadge,
  Modal,
  PageHeader,
  SecretBox,
  Skeleton,
  StatTile,
  Table,
  Tabs,
  Td,
  Th,
  useToast,
} from '@/components/ui';
import { api, useQuery } from '@/lib/api';
import { ago, crop, dateTime, num, qty, rwf } from '@/lib/format';

type Tab = 'stock' | 'market' | 'certificates' | 'alerts' | 'history';
type Dialog = 'unlock' | 'reset' | 'suspend' | 'reactivate' | 'signout' | null;

export default function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const can = useCan();
  const toast = useToast();
  const detail = useQuery<any>(`users/${id}`);
  const [tab, setTab] = useState<Tab>('stock');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [pin, setPin] = useState<string | null>(null);

  if (detail.error) return <ErrorBox error={detail.error} onRetry={detail.reload} />;
  const d = detail.data;
  if (!d) return <Skeleton className="h-96 rounded-xl" />;
  const u = d.user;
  const farmer = u.role === 'farmer';
  // Buyers have no stock or certificates: show their orders first.
  const shown: Tab = !farmer && (tab === 'stock' || tab === 'certificates') ? 'market' : tab;
  const gmv = d.orders.filter((o: any) => o.status === 'accepted').reduce((s: number, o: any) => s + o.quantity * o.pricePerUnit, 0);
  const act = async (path: string, body?: unknown, msg?: string) => {
    const r = await api(`users/${id}/${path}`, { method: 'POST', body });
    if (msg) toast(msg);
    await detail.reload();
    return r;
  };

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/people" className="hover:underline">Farmers & buyers</Link>}
        title={
          <span className="flex items-center gap-3">
            <Avatar name={u.name} photoId={u.photoId} size={40} />
            {u.businessName ?? u.name}
            <PersonStatus p={u} />
          </span>
        }
        subtitle={
          <span className="inline-flex flex-wrap gap-x-3">
            <span className="capitalize">{u.role}</span>
            {u.businessName && <span>{u.name}</span>}
            <span>{u.phone}</span>
            <span>{u.district}</span>
            {d.room && <Link className="hover:underline" href={`/rooms/${d.room.id}`}>{d.room.name}</Link>}
            <span>Joined {dateTime(u.createdAt)} · last seen {ago(u.lastSeenAt)}</span>
          </span>
        }
        actions={
          can('support') && (
            <>
              {u.locked && <Button variant="primary" icon={<LockOpen className="size-4" />} onClick={() => setDialog('unlock')}>Unlock</Button>}
              <Button icon={<KeyRound className="size-4" />} onClick={() => setDialog('reset')}>Reset PIN</Button>
              <Button icon={<LogOut className="size-4" />} onClick={() => setDialog('signout')}>Sign out phones</Button>
              {u.status === 'suspended' ? (
                <Button icon={<PlayCircle className="size-4" />} onClick={() => setDialog('reactivate')}>Reactivate</Button>
              ) : (
                <Button variant="danger" icon={<PauseCircle className="size-4" />} onClick={() => setDialog('suspend')}>Suspend</Button>
              )}
            </>
          )
        }
      />

      {u.locked && (
        <div className="mb-6 rounded-xl border border-critical/30 bg-critical-soft px-4 py-3 text-sm text-critical-ink">
          Locked {ago(u.lockedAt)} after {u.failedPinAttempts || 5} wrong PINs. Before unlocking, call the person on their registered number to check it is really them.
        </div>
      )}
      {u.status === 'suspended' && (
        <div className="mb-6 rounded-xl border border-warning/50 bg-warning-soft px-4 py-3 text-sm text-warning-ink">Suspended: {u.statusReason}</div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {farmer ? (
          <>
            <StatTile label="In storage" value={num(d.stock.filter((b: any) => b.status === 'stored').length)} sub="batches now" />
            <StatTile label="Listings" value={num(d.listings.length)} sub={`${d.listings.filter((l: any) => l.status === 'active').length} on sale`} />
          </>
        ) : (
          <>
            <StatTile label="Orders" value={num(d.orders.length)} sub={`${d.orders.filter((o: any) => o.status === 'pending').length} waiting`} />
            <StatTile label="Business" value={u.businessType ?? '–'} />
          </>
        )}
        <StatTile label={farmer ? 'Sold' : 'Bought'} value={rwf(gmv)} sub="accepted orders" />
        <StatTile label="Phones signed in" value={d.sessions.active} sub={d.sessions.lastSignIn ? `last ${ago(d.sessions.lastSignIn)}` : 'none'} />
      </div>

      <Tabs
        value={shown}
        onChange={setTab}
        tabs={[
          ...(farmer ? [{ value: 'stock' as Tab, label: 'Stock', count: d.stock.length }] : []),
          { value: 'market', label: farmer ? 'Listings & orders' : 'Orders', count: d.orders.length },
          ...(farmer ? [{ value: 'certificates' as Tab, label: 'Certificates', count: d.certificates.length }] : []),
          { value: 'alerts', label: 'Alerts sent', count: d.alerts.length },
          { value: 'history', label: 'Audit history' },
        ]}
      />
      <div className="mt-6">
        {shown === 'stock' && (
          <Card>
            {d.stock.length ? (
              <Table>
                <thead><tr><Th>Batch</Th><Th>Stored</Th><Th>Status</Th><Th>Freshness</Th></tr></thead>
                <tbody>
                  {d.stock.map((b: any) => (
                    <tr key={b.id}>
                      <Td><span className="font-medium">{crop(b.crop)}</span> · {qty(b.quantity, b.unit)}<div className="text-[13px] text-ink-3">{b.id}</div></Td>
                      <Td>{dateTime(b.storedAt)}</Td>
                      <Td>{b.status === 'stored' ? <Badge tone="brand">In the room</Badge> : <Badge>Taken out</Badge>}</Td>
                      <Td>{b.freshness ? <FreshnessBadge value={b.freshness} /> : '–'}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <EmptyState title="No stock yet" />
            )}
          </Card>
        )}
        {shown === 'market' && (
          <div className="space-y-6">
            {farmer && (
              <Card>
                <CardHeader title="Listings" />
                {d.listings.length ? (
                  <Table>
                    <thead><tr><Th>Listing</Th><Th align="right">Price</Th><Th>Status</Th><Th>Created</Th></tr></thead>
                    <tbody>
                      {d.listings.map((l: any) => (
                        <tr key={l.id}>
                          <Td><span className="font-medium">{crop(l.crop)}</span> · {qty(l.quantity, l.unit)} left<div className="text-[13px] text-ink-3">{l.id}</div></Td>
                          <Td align="right">{rwf(l.pricePerUnit)} / {l.unit}</Td>
                          <Td><div className="flex gap-1">{l.status === 'active' ? <Badge tone="good">On sale</Badge> : <Badge>{l.status}</Badge>}{l.moderation === 'hidden' && <Badge tone="warning">Hidden</Badge>}</div></Td>
                          <Td>{dateTime(l.createdAt)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                ) : (
                  <EmptyState title="No listings" />
                )}
              </Card>
            )}
            <Card>
              <CardHeader title="Orders" />
              {d.orders.length ? (
                <Table>
                  <thead><tr><Th>Order</Th><Th align="right">Total</Th><Th>Status</Th><Th>Placed</Th></tr></thead>
                  <tbody>
                    {d.orders.map((o: any) => (
                      <tr key={o.id}>
                        <Td><span className="font-medium">{crop(o.crop)}</span> · {qty(o.quantity, o.unit)}<div className="text-[13px] text-ink-3">{o.id}{o.note ? ` · “${o.note}”` : ''}</div></Td>
                        <Td align="right">{rwf(o.quantity * o.pricePerUnit)}</Td>
                        <Td><Badge tone={o.status === 'accepted' ? 'good' : o.status === 'pending' ? 'warning' : 'neutral'}>{o.status}</Badge></Td>
                        <Td>{dateTime(o.createdAt)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              ) : (
                <EmptyState title="No orders" />
              )}
            </Card>
          </div>
        )}
        {shown === 'certificates' && (
          <Card>
            {d.certificates.length ? (
              <Table>
                <thead><tr><Th>Certificate</Th><Th>Crop</Th><Th>Result</Th><Th>Issued</Th></tr></thead>
                <tbody>
                  {d.certificates.map((c: any) => (
                    <tr key={c.id}>
                      <Td><Link href={`/certificates/${c.id}`} className="font-mono font-medium hover:underline">{c.id}</Link>{c.revoked_at && <Badge tone="critical" className="ml-2">Revoked</Badge>}</Td>
                      <Td>{crop(c.crop)}</Td>
                      <Td><FreshnessBadge value={c.freshness} /></Td>
                      <Td>{dateTime(c.issued_at)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <EmptyState title="No certificates" />
            )}
          </Card>
        )}
        {shown === 'alerts' && (
          <Card>
            {d.alerts.length ? (
              <ul className="divide-y divide-line">
                {d.alerts.map((a: any) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <span><span className="font-medium">{a.type}</span> <span className="text-ink-3">{Object.entries(a.params).map(([k, v]) => `${k}: ${v}`).join(' · ')}</span></span>
                    <span className="shrink-0 text-[13px] text-ink-3">{dateTime(a.createdAt)} {a.read ? '· read' : ''}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No alerts sent" />
            )}
          </Card>
        )}
        {shown === 'history' && (
          <Card>
            <AuditList entries={d.audit} />
          </Card>
        )}
      </div>

      <ActionDialog
        open={dialog === 'unlock'}
        onClose={() => setDialog(null)}
        title={`Unlock ${u.name}?`}
        description="Only after checking it is really them, for example by calling back on their registered number."
        confirmLabel="Unlock account"
        reasonLabel="How did you check their identity?"
        onConfirm={(verification) => act('unlock', { verification }, 'Account unlocked')}
      />
      <ActionDialog
        open={dialog === 'reset'}
        onClose={() => setDialog(null)}
        title={`New PIN for ${u.name}`}
        description="A new 4-digit PIN is created and shown to you once, to read to the person. Their phones are signed out and the account is unlocked."
        confirmLabel="Create new PIN"
        reasonLabel="How did you check their identity?"
        onConfirm={async (verification) => {
          const r = await act('reset-pin', { verification });
          setPin((r as { pin: string }).pin);
        }}
      />
      <ActionDialog
        open={dialog === 'suspend'}
        onClose={() => setDialog(null)}
        title={`Suspend ${u.name}?`}
        description="They are signed out on every phone, cannot sign in, and their listings leave the market until reactivated."
        confirmLabel="Suspend"
        danger
        reasonLabel="Reason"
        onConfirm={(reason) => act('suspend', { reason }, 'Account suspended')}
      />
      <ActionDialog
        open={dialog === 'reactivate'}
        onClose={() => setDialog(null)}
        title={`Reactivate ${u.name}?`}
        confirmLabel="Reactivate"
        reasonLabel="Reason"
        onConfirm={(reason) => act('reactivate', { reason }, 'Account reactivated')}
      />
      <ActionDialog
        open={dialog === 'signout'}
        onClose={() => setDialog(null)}
        title={`Sign ${u.name} out of every phone?`}
        description="For a lost or stolen phone. They sign in again with their PIN."
        confirmLabel="Sign out everywhere"
        onConfirm={() => act('sign-out', undefined, 'Signed out of all phones')}
      />
      <Modal open={!!pin} onClose={() => setPin(null)} title="New PIN" footer={<Button variant="primary" onClick={() => setPin(null)}>Done</Button>}>
        {pin && <SecretBox label={`Read this PIN to ${u.name}`} value={pin} note="Shown once. Ask them to keep it private." />}
      </Modal>
    </>
  );
}
