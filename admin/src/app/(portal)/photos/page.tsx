'use client';

import { Image as ImageIcon, RotateCcw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { useCan } from '@/components/admin-context';
import { ActionDialog, Badge, Card, EmptyState, ErrorBox, Modal, PageHeader, Segmented, Skeleton, useToast } from '@/components/ui';
import { api, useQuery } from '@/lib/api';
import { dateTime } from '@/lib/format';

const KIND: Record<string, string> = { listing: 'Listing', checkin: 'Check-in', profile: 'Profile' };

export default function PhotosPage() {
  const [kind, setKind] = useState<'all' | 'listing' | 'checkin' | 'profile'>('all');
  const [status, setStatus] = useState<'active' | 'removed'>('active');
  const params = new URLSearchParams({ status });
  if (kind !== 'all') params.set('kind', kind);
  const list = useQuery<any[]>(`photos?${params}`);
  const can = useCan();
  const toast = useToast();
  const [view, setView] = useState<any>(null);
  const [remove, setRemove] = useState<any>(null);

  return (
    <>
      <PageHeader
        title="Photos"
        subtitle="Newest first. Uploads are resized and stripped of their metadata (including GPS position) before they are stored. Remove anything that is not a real photo of the crop or person."
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <Segmented value={kind} onChange={setKind} options={[{ value: 'all', label: 'All' }, { value: 'listing', label: 'Listings' }, { value: 'checkin', label: 'Check-in' }, { value: 'profile', label: 'Profiles' }]} />
        <Segmented value={status} onChange={setStatus} options={[{ value: 'active', label: 'Visible' }, { value: 'removed', label: 'Removed' }]} />
      </div>
      {list.error && <ErrorBox error={list.error} onRetry={list.reload} />}
      {!list.data ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="aspect-square rounded-xl" />)}</div>
      ) : !list.data.length ? (
        <Card><EmptyState icon={<ImageIcon className="size-6" />} title="No photos here" /></Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
          {list.data.map((p) => (
            <Card key={p.id} className="overflow-hidden">
              {p.purged_at ? (
                <div className="flex aspect-square w-full items-center justify-center bg-surface-3 p-3 text-center text-xs text-ink-3">File deleted 30 days after removal</div>
              ) : (
                <button onClick={() => setView(p)} className="block aspect-square w-full bg-surface-3" aria-label={`Open ${KIND[p.kind]} photo by ${p.owner_name}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/admin/photos/${p.id}/file?size=thumb`} alt="" className="size-full object-cover" loading="lazy" />
                </button>
              )}
              <div className="space-y-1 p-2.5">
                <div className="flex items-center justify-between gap-1">
                  <Badge>{KIND[p.kind]}</Badge>
                  {can('market') && !p.purged_at && (status === 'active' ? (
                    <button className="rounded p-1 text-ink-3 hover:bg-critical-soft hover:text-critical-ink" onClick={() => setRemove(p)} aria-label="Remove photo"><Trash2 className="size-3.5" /></button>
                  ) : (
                    <button className="rounded p-1 text-ink-3 hover:bg-surface-3 hover:text-ink" onClick={async () => { await api(`photos/${p.id}/restore`, { method: 'POST' }); toast('Photo restored'); await list.reload(); }} aria-label="Restore photo"><RotateCcw className="size-3.5" /></button>
                  ))}
                </div>
                <Link href={`/people/${p.owner_id}`} className="block truncate text-[13px] text-ink hover:underline">{p.owner_name}</Link>
                <div className="text-xs text-ink-3">{dateTime(p.created_at)}</div>
                {p.removed_reason && <div className="text-xs text-critical-ink">Removed: {p.removed_reason}</div>}
              </div>
            </Card>
          ))}
        </div>
      )}
      <Modal open={!!view} onClose={() => setView(null)} title={view ? `${KIND[view.kind]} photo · ${view.owner_name}` : ''} wide>
        {view && (
          <div className="space-y-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/admin/photos/${view.id}/file`} alt="" className="max-h-[60vh] w-full rounded-lg object-contain" />
            <div className="text-[13px] text-ink-3">{view.width}×{view.height} · {Math.round(view.bytes / 1024)} KB WebP · uploaded {dateTime(view.created_at)} · {view.kind} {view.entity_id}</div>
          </div>
        )}
      </Modal>
      <ActionDialog
        open={!!remove}
        onClose={() => setRemove(null)}
        title="Remove this photo?"
        description="It disappears from the app and the market at once. You can restore it from “Removed” for 30 days."
        confirmLabel="Remove"
        danger
        reasonLabel="Reason"
        onConfirm={async (reason) => {
          await api(`photos/${remove.id}/remove`, { method: 'POST', body: { reason } });
          toast('Photo removed');
          await list.reload();
        }}
      />
    </>
  );
}
