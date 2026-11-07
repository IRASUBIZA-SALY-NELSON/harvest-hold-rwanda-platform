'use client';

import { Siren } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { useCan } from '@/components/admin-context';
import { ActionDialog, Badge, Button, Card, EmptyState, ErrorBox, PageHeader, Segmented, Skeleton, Table, Td, Th, useToast } from '@/components/ui';
import { api, useQuery } from '@/lib/api';
import { dateTime, duration, incident } from '@/lib/format';
import { useLiveEvents } from '@/lib/live';

export default function IncidentsPage() {
  const [state, setState] = useState<'open' | 'closed' | 'all'>('open');
  const list = useQuery<any[]>(`incidents${state === 'all' ? '' : `?state=${state}`}`, { refreshMs: 60_000 });
  const can = useCan();
  const toast = useToast();
  const [ack, setAck] = useState<any>(null);
  useLiveEvents((e) => e.type === 'incident' && void list.reload());

  return (
    <>
      <PageHeader title="Incidents" subtitle="Every room problem from start to end, and who handled it. New ones appear here live." />
      <div className="mb-4">
        <Segmented value={state} onChange={setState} options={[{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Resolved' }, { value: 'all', label: 'All' }]} />
      </div>
      {list.error && <ErrorBox error={list.error} onRetry={list.reload} />}
      <Card>
        {!list.data ? (
          <div className="p-4"><Skeleton className="h-24" /></div>
        ) : !list.data.length ? (
          <EmptyState icon={<Siren className="size-6" />} title={state === 'open' ? 'No open incidents' : 'Nothing here'} body={state === 'open' ? 'Every room is within its limits.' : undefined} />
        ) : (
          <Table>
            <thead><tr><Th>Problem</Th><Th>Room</Th><Th>Started</Th><Th>Duration</Th><Th>Handled</Th><Th /></tr></thead>
            <tbody>
              {list.data.map((i) => (
                <tr key={i.id}>
                  <Td>
                    <div className="flex items-center gap-2">
                      {i.endedAt ? <Badge tone="good">Resolved</Badge> : <Badge tone="critical">Open</Badge>}
                      <span className="font-medium">{incident(i.type)}</span>
                    </div>
                  </Td>
                  <Td><Link className="hover:underline" href={`/rooms/${i.roomId}`}>{i.roomName}</Link></Td>
                  <Td>{dateTime(i.startedAt)}</Td>
                  <Td>{duration(i.durationMin)}</Td>
                  <Td className="max-w-xs">{i.acknowledgedAt ? <span className="text-[13px] text-ink-2">{i.acknowledgedBy}: “{i.note}”</span> : <span className="text-ink-3">–</span>}</Td>
                  <Td align="right">{!i.acknowledgedAt && can('operations', 'support') && <Button size="sm" onClick={() => setAck(i)}>Acknowledge</Button>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <ActionDialog
        open={!!ack}
        onClose={() => setAck(null)}
        title={ack ? `Acknowledge: ${incident(ack.type)} in ${ack.roomName}` : ''}
        confirmLabel="Acknowledge"
        reasonLabel="What was done"
        reasonHint="E.g. “Farmer reached by phone; hot-side fan cable was loose, fixed.”"
        minLength={3}
        onConfirm={async (note) => {
          await api(`incidents/${ack.id}/acknowledge`, { method: 'POST', body: { note } });
          toast('Incident acknowledged');
          await list.reload();
        }}
      />
    </>
  );
}
