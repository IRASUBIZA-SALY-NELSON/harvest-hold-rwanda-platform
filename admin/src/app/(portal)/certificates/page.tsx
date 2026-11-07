'use client';

import { Award, Camera, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Badge, Card, EmptyState, ErrorBox, FreshnessBadge, Input, PageHeader, Segmented, Skeleton, Table, Td, Th } from '@/components/ui';
import { useQuery } from '@/lib/api';
import { crop, dateTime, qty, temp } from '@/lib/format';

export default function CertificatesPage() {
  const [freshness, setFreshness] = useState<'all' | 'fresh' | 'attention' | 'unknown'>('all');
  const [state, setState] = useState<'all' | 'valid' | 'revoked'>('all');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const params = new URLSearchParams();
  if (freshness !== 'all') params.set('freshness', freshness);
  if (state !== 'all') params.set('state', state);
  if (debounced) params.set('q', debounced);
  const list = useQuery<any[]>(`certificates?${params}`);

  return (
    <>
      <PageHeader
        title="Certificates"
        subtitle="Every certificate issued: a fixed, digitally signed record of the cold room conditions. Open one to preview it, check its signature or revoke it."
        actions={<a href="/api/admin/export/certificates.csv?days=365" className="text-[13px] font-medium text-brand-ink hover:underline">Export CSV</a>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented value={freshness} onChange={setFreshness} options={[{ value: 'all', label: 'Any result' }, { value: 'fresh', label: 'Kept fresh' }, { value: 'attention', label: 'Check quality' }, { value: 'unknown', label: 'No data' }]} />
        <Segmented value={state} onChange={setState} options={[{ value: 'all', label: 'All' }, { value: 'valid', label: 'Valid' }, { value: 'revoked', label: 'Revoked' }]} />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Number or farmer" className="max-w-xs" />
      </div>
      {list.error && <ErrorBox error={list.error} onRetry={list.reload} />}
      <Card>
        {!list.data ? (
          <div className="p-4"><Skeleton className="h-32" /></div>
        ) : !list.data.length ? (
          <EmptyState icon={<Award className="size-6" />} title="No certificates match" />
        ) : (
          <Table>
            <thead><tr><Th>Certificate</Th><Th>Crop</Th><Th>Farmer · room</Th><Th align="right">Avg temp</Th><Th>Result</Th><Th>Issued</Th></tr></thead>
            <tbody>
              {list.data.map((c) => (
                <tr key={c.id} className="hover:bg-surface-2">
                  <Td>
                    <Link href={`/certificates/${c.id}`} className="font-mono font-medium hover:underline">{c.id}</Link>
                    <div className="mt-0.5 flex gap-1">
                      {c.revoked_at ? <Badge tone="critical">Revoked</Badge> : c.signed ? <Badge tone="brand" icon={<ShieldCheck className="size-3" />}>Signed</Badge> : <Badge>Unsigned</Badge>}
                      {c.photos > 0 && <Badge icon={<Camera className="size-3" />}>{c.photos}</Badge>}
                    </div>
                  </Td>
                  <Td>{crop(c.crop)} · {qty(c.quantity, c.unit)}</Td>
                  <Td>{c.farmer}<div className="text-[13px] text-ink-3">{c.room}</div></Td>
                  <Td align="right">{temp(c.avg_temp)}</Td>
                  <Td><FreshnessBadge value={c.freshness} /></Td>
                  <Td>{dateTime(c.issued_at)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
