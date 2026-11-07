'use client';

import { Download, Link2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';

import { type AuditEntry, AuditList } from '@/components/domain/audit-list';
import { Button, Card, ErrorBox, Input, PageHeader, Select, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { num } from '@/lib/format';
import { useLiveEvents } from '@/lib/live';

const ACTIONS = [
  ['', 'All actions'],
  ['admin.', 'Staff sign-ins & security'],
  ['staff.', 'Staff accounts'],
  ['user.', 'Farmer & buyer accounts'],
  ['room.', 'Cold rooms'],
  ['incident.', 'Incidents'],
  ['stock.', 'Stock'],
  ['certificate.', 'Certificates'],
  ['listing.', 'Listings'],
  ['order.', 'Orders'],
  ['photo.', 'Photos'],
  ['crop.', 'Crop profiles'],
  ['firmware.', 'Firmware'],
  ['export', 'Exports'],
];

export default function AuditPage() {
  const [actorType, setActorType] = useState('');
  const [action, setAction] = useState('');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [chain, setChain] = useState<{ ok: boolean; checked: number; brokenAt: number | null } | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const query = (before?: number) => {
    const p = new URLSearchParams();
    if (actorType) p.set('actorType', actorType);
    if (action) p.set('action', action);
    if (debounced) p.set('q', debounced);
    if (before) p.set('before', String(before));
    return `audit?${p}`;
  };

  const load = async () => {
    try {
      const r = await api<{ entries: AuditEntry[]; next: number | null }>(query());
      setError(null);
      setEntries(r.entries);
      setNext(r.next);
    } catch (e) {
      setError(e);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setTimeout(load, 0); // after render: the filters just changed
    return () => clearTimeout(t);
  }, [actorType, action, debounced]);
  useLiveEvents((e) => e.type === 'audit' && !actorType && !action && !debounced && void load());

  const verify = async () => {
    setChecking(true);
    try {
      setChain(await api('audit/verify'));
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Audit trail"
        subtitle="Everything that changed the system: who, what, when, from where, with before and after values. Entries are append-only and hash-chained: editing or deleting any one breaks the chain."
        actions={
          <>
            <a href="/api/admin/export/audit.csv?days=365" className="inline-flex h-9 items-center gap-2 rounded-lg border border-line-strong px-3.5 text-sm font-medium text-ink hover:bg-surface-3"><Download className="size-4" />Export</a>
            <Button icon={<Link2 className="size-4" />} loading={checking} onClick={verify}>Verify chain</Button>
          </>
        }
      />
      {chain && (
        <div className={`mb-4 flex items-center gap-3 rounded-xl border px-4 py-3 text-sm ${chain.ok ? 'border-good/30 bg-good-soft text-good-ink' : 'border-critical/30 bg-critical-soft text-critical-ink'}`}>
          {chain.ok ? <ShieldCheck className="size-5" /> : <ShieldAlert className="size-5" />}
          {chain.ok
            ? `Chain intact: all ${num(chain.checked)} entries match their hashes. Nothing was edited or removed.`
            : `Chain broken at entry #${chain.brokenAt}: that entry or one before it was changed or deleted outside the system. Investigate database access.`}
        </div>
      )}
      <div className="mb-4 flex flex-wrap gap-3">
        <Select value={actorType} onChange={(e) => setActorType(e.target.value)} className="w-44">
          <option value="">Anyone</option>
          <option value="admin">Staff</option>
          <option value="user">Farmers & buyers</option>
          <option value="system">System</option>
        </Select>
        <Select value={action} onChange={(e) => setAction(e.target.value)} className="w-60">
          {ACTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search summaries and names" className="max-w-xs" />
      </div>
      {error ? <ErrorBox error={error} onRetry={load} /> : null}
      <Card>
        {!entries ? <div className="p-4"><Skeleton className="h-48" /></div> : <AuditList entries={entries} />}
        {next && (
          <div className="border-t border-line p-3 text-center">
            <Button
              size="sm"
              onClick={async () => {
                const r = await api<{ entries: AuditEntry[]; next: number | null }>(query(next));
                setEntries((e) => [...(e ?? []), ...r.entries]);
                setNext(r.next);
              }}
            >
              Load older entries
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}
