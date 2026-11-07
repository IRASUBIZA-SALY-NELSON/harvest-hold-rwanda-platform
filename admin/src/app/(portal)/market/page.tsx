'use client';

import { EyeOff, ImageOff, ShoppingBasket } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { useCan } from '@/components/admin-context';
import { ActionDialog, Badge, Button, Card, EmptyState, ErrorBox, FreshnessBadge, PageHeader, Segmented, Skeleton, Table, Tabs, Td, Th, useToast } from '@/components/ui';
import { api, useQuery } from '@/lib/api';
import { crop, dateTime, qty, rwf } from '@/lib/format';
import { useLiveEvents } from '@/lib/live';

function Listings({ highlight }: { highlight?: string | null }) {
  const [moderation, setModeration] = useState<'all' | 'visible' | 'hidden'>('all');
  const list = useQuery<any[]>(`listings${moderation === 'all' ? '' : `?moderation=${moderation}`}`);
  const can = useCan();
  const toast = useToast();
  const [hide, setHide] = useState<any>(null);

  return (
    <>
      <div className="mb-4">
        <Segmented value={moderation} onChange={setModeration} options={[{ value: 'all', label: 'All listings' }, { value: 'visible', label: 'On the market' }, { value: 'hidden', label: 'Hidden by moderators' }]} />
      </div>
      {list.error && <ErrorBox error={list.error} onRetry={list.reload} />}
      {!list.data ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-72 rounded-xl" />)}</div>
      ) : !list.data.length ? (
        <Card><EmptyState icon={<ShoppingBasket className="size-6" />} title="No listings" /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.data.map((l) => (
            <Card key={l.id} className={highlight === l.id ? 'ring-2 ring-[var(--focus)]' : ''}>
              <div className="relative aspect-[4/3] overflow-hidden rounded-t-xl bg-surface-3">
                {l.photos[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/admin/photos/${l.photos[0]}/file?size=thumb`} alt={`${crop(l.crop)} by ${l.farmerName}`} className="size-full object-cover" />
                ) : (
                  <div className="flex size-full items-center justify-center text-ink-3"><ImageOff className="size-8" aria-label="No photo" /></div>
                )}
                {l.photos.length > 1 && <span className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">{l.photos.length} photos</span>}
                {l.moderation === 'hidden' && (
                  <span className="absolute inset-x-0 top-0 flex items-center gap-1.5 bg-warning px-3 py-1.5 text-[13px] font-medium text-black"><EyeOff className="size-3.5" />Hidden: {l.moderationReason}</span>
                )}
              </div>
              <div className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{crop(l.crop)}</div>
                    <div className="text-[13px] text-ink-3"><Link href={`/people/${l.farmerId}`} className="hover:underline">{l.farmerName}</Link> · {l.roomName}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold tabular">{rwf(l.pricePerUnit)}</div>
                    <div className="text-[13px] text-ink-3">per {l.unit}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {l.status === 'active' ? <Badge tone="good">On sale</Badge> : <Badge>{l.status}</Badge>}
                  <FreshnessBadge value={l.freshness} />
                  <Badge>{qty(l.quantity, l.unit)} left</Badge>
                  {l.orders > 0 && <Badge tone="info">{l.orders} orders</Badge>}
                  {l.farmerStatus === 'suspended' && <Badge tone="warning">Farmer suspended</Badge>}
                </div>
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs text-ink-3">{dateTime(l.createdAt)}</span>
                  {can('market') &&
                    (l.moderation === 'hidden' ? (
                      <Button size="sm" onClick={async () => { await api(`listings/${l.id}/unhide`, { method: 'POST' }); toast('Back on the market'); await list.reload(); }}>Put back</Button>
                    ) : (
                      <Button size="sm" icon={<EyeOff className="size-3.5" />} onClick={() => setHide(l)}>Hide</Button>
                    ))}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      <ActionDialog
        open={!!hide}
        onClose={() => setHide(null)}
        title={hide ? `Hide ${crop(hide.crop)} by ${hide.farmerName}?` : ''}
        description="Buyers stop seeing it and cannot order it. The farmer still sees it, with your reason, so they can fix the problem."
        confirmLabel="Hide from market"
        reasonLabel="Reason (the farmer sees it)"
        onConfirm={async (reason) => {
          await api(`listings/${hide.id}/hide`, { method: 'POST', body: { reason } });
          toast('Listing hidden');
          await list.reload();
        }}
      />
    </>
  );
}

function Orders({ highlight }: { highlight?: string | null }) {
  const [status, setStatus] = useState<'all' | 'pending' | 'accepted' | 'declined' | 'cancelled'>('all');
  const list = useQuery<any[]>(`orders${status === 'all' ? '' : `?status=${status}`}`);
  useLiveEvents((e) => e.type === 'order' && void list.reload());
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented value={status} onChange={setStatus} options={[{ value: 'all', label: 'All' }, { value: 'pending', label: 'Waiting' }, { value: 'accepted', label: 'Accepted' }, { value: 'declined', label: 'Declined' }, { value: 'cancelled', label: 'Cancelled' }]} />
        <a href="/api/admin/export/orders.csv?days=365" className="text-[13px] font-medium text-brand-ink hover:underline">Export CSV</a>
      </div>
      {list.error && <ErrorBox error={list.error} onRetry={list.reload} />}
      <Card>
        {!list.data ? (
          <div className="p-4"><Skeleton className="h-32" /></div>
        ) : !list.data.length ? (
          <EmptyState title="No orders" />
        ) : (
          <Table>
            <thead><tr><Th>Order</Th><Th>Buyer</Th><Th>Farmer</Th><Th align="right">Total</Th><Th>Status</Th><Th>Placed</Th></tr></thead>
            <tbody>
              {list.data.map((o) => (
                <tr key={o.id} className={highlight === o.id ? 'bg-info-soft' : ''}>
                  <Td><span className="font-medium">{crop(o.crop)}</span> · {qty(o.quantity, o.unit)}<div className="text-[13px] text-ink-3">{o.id}{o.note ? ` · “${o.note}”` : ''}</div></Td>
                  <Td><Link className="hover:underline" href={`/people/${o.buyerId}`}>{o.buyerName}</Link></Td>
                  <Td><Link className="hover:underline" href={`/people/${o.farmerId}`}>{o.farmerName}</Link></Td>
                  <Td align="right">{rwf(o.total)}</Td>
                  <Td><Badge tone={o.status === 'accepted' ? 'good' : o.status === 'pending' ? 'warning' : 'neutral'}>{o.status}</Badge></Td>
                  <Td>{dateTime(o.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

function Market() {
  const search = useSearchParams();
  const [tab, setTab] = useState<'listings' | 'orders'>(search.get('order') ? 'orders' : 'listings');
  return (
    <>
      <PageHeader title="Listings & orders" subtitle="What farmers sell and what buyers order. Hide a listing that breaks the rules; every decision is in the audit trail." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'listings', label: 'Listings' }, { value: 'orders', label: 'Orders' }]} />
      <div className="mt-6">{tab === 'listings' ? <Listings highlight={search.get('listing')} /> : <Orders highlight={search.get('order')} />}</div>
    </>
  );
}

export default function MarketPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
      <Market />
    </Suspense>
  );
}
