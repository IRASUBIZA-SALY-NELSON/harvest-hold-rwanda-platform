'use client';

import { Users } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Avatar, PersonStatus } from '@/components/domain/people';
import { Card, EmptyState, ErrorBox, Input, PageHeader, Segmented, Skeleton, Table, Td, Th } from '@/components/ui';
import { useQuery } from '@/lib/api';
import { ago, num, rwfCompact } from '@/lib/format';

export default function PeoplePage() {
  const [role, setRole] = useState<'all' | 'farmer' | 'buyer'>('all');
  const [status, setStatus] = useState<'all' | 'active' | 'locked' | 'suspended'>('all');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const params = new URLSearchParams();
  if (role !== 'all') params.set('role', role);
  if (status !== 'all') params.set('status', status);
  if (debounced) params.set('q', debounced);
  const people = useQuery<any[]>(`users?${params}`);

  return (
    <>
      <PageHeader
        title="Farmers & buyers"
        subtitle="Everyone using the app. Locked accounts (too many wrong PINs) come first."
        actions={<a href="/api/admin/export/users.csv" className="text-[13px] font-medium text-brand-ink hover:underline">Export CSV</a>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented value={role} onChange={setRole} options={[{ value: 'all', label: 'Everyone' }, { value: 'farmer', label: 'Farmers' }, { value: 'buyer', label: 'Buyers' }]} />
        <Segmented value={status} onChange={setStatus} options={[{ value: 'all', label: 'Any status' }, { value: 'active', label: 'Active' }, { value: 'locked', label: 'Locked' }, { value: 'suspended', label: 'Suspended' }]} />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, business, phone or district" className="max-w-xs" />
      </div>
      {people.error && <ErrorBox error={people.error} onRetry={people.reload} />}
      <Card>
        {!people.data ? (
          <div className="space-y-2 p-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : !people.data.length ? (
          <EmptyState icon={<Users className="size-6" />} title="Nobody matches" />
        ) : (
          <Table>
            <thead><tr><Th>Person</Th><Th>Role</Th><Th>Where</Th><Th align="right">Stock</Th><Th align="right">Orders</Th><Th align="right">Sales</Th><Th>Last seen</Th><Th>Status</Th></tr></thead>
            <tbody>
              {people.data.map((p) => (
                <tr key={p.id} className="hover:bg-surface-2">
                  <Td>
                    <Link href={`/people/${p.id}`} className="flex items-center gap-3">
                      <Avatar name={p.name} photoId={p.photoId} />
                      <span>
                        <span className="font-medium hover:underline">{p.businessName ?? p.name}</span>
                        <span className="block text-[13px] text-ink-3">{p.businessName ? `${p.name} · ` : ''}{p.phone}</span>
                      </span>
                    </Link>
                  </Td>
                  <Td className="capitalize">{p.role}</Td>
                  <Td>{p.district}{p.roomName && <div className="text-[13px] text-ink-3">{p.roomName}</div>}</Td>
                  <Td align="right">{p.role === 'farmer' ? num(p.storedBatches) : '–'}</Td>
                  <Td align="right">{num(p.orders)}</Td>
                  <Td align="right">{rwfCompact(p.gmv)}</Td>
                  <Td className="text-ink-2">{ago(p.lastSeenAt)}</Td>
                  <Td><PersonStatus p={p} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
