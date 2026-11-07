'use client';

import { Badge } from '../ui';

export function Avatar({ name, photoId, size = 32 }: { name: string; photoId?: string | null; size?: number }) {
  const initials = name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return photoId ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`/api/admin/photos/${photoId}/file?size=thumb`} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span className="flex shrink-0 items-center justify-center rounded-full bg-surface-3 text-xs font-semibold text-ink-2" style={{ width: size, height: size }}>{initials}</span>
  );
}

export function PersonStatus({ p }: { p: { locked: boolean; status: string } }) {
  if (p.status === 'suspended') return <Badge tone="warning">Suspended</Badge>;
  if (p.locked) return <Badge tone="critical">Locked</Badge>;
  return <Badge tone="good">Active</Badge>;
}

