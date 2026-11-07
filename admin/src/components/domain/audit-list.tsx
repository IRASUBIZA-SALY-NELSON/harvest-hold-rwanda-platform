'use client';

import clsx from 'clsx';
import { Bot, ChevronRight, Cpu, Shield, User } from 'lucide-react';
import { useState } from 'react';

import { dateTime } from '@/lib/format';

import { EmptyState } from '../ui';

export interface AuditEntry {
  id: number;
  at: string;
  actor_type: 'admin' | 'user' | 'device' | 'system';
  actor_name: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  summary: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
  hash: string;
}

const ICON = { admin: Shield, user: User, device: Cpu, system: Bot };

const show = (v: unknown) => (v === null || v === undefined ? '–' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** Before → after, field by field. */
function Diff({ before, after }: { before: Record<string, unknown> | null; after: Record<string, unknown> | null }) {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  if (!keys.length) return null;
  return (
    <table className="mt-2 w-full text-[13px]">
      <thead>
        <tr className="text-left text-ink-3">
          <th className="py-1 pr-3 font-medium">Field</th>
          {before && <th className="py-1 pr-3 font-medium">Before</th>}
          {after && <th className="py-1 font-medium">After</th>}
        </tr>
      </thead>
      <tbody>
        {keys.map((k) => (
          <tr key={k} className="border-t border-line align-top">
            <td className="py-1 pr-3 font-mono text-ink-2">{k}</td>
            {before && <td className="py-1 pr-3 font-mono text-critical-ink break-all">{show(before[k])}</td>}
            {after && <td className="py-1 font-mono text-good-ink break-all">{show(after[k])}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function AuditList({ entries }: { entries: AuditEntry[] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!entries.length) return <EmptyState title="No entries" />;
  return (
    <ul className="divide-y divide-line">
      {entries.map((e) => {
        const Icon = ICON[e.actor_type] ?? Bot;
        const expandable = !!(e.before || e.after || e.ip);
        const isOpen = open === e.id;
        return (
          <li key={e.id}>
            <button
              className={clsx('flex w-full items-start gap-3 px-5 py-3 text-left', expandable && 'hover:bg-surface-2')}
              onClick={() => expandable && setOpen(isOpen ? null : e.id)}
              aria-expanded={expandable ? isOpen : undefined}
            >
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-3 text-ink-2">
                <Icon className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-ink">{e.summary}</span>
                <span className="block text-xs text-ink-3">
                  {dateTime(e.at)} · {e.actor_name ?? e.actor_type} · <span className="font-mono">{e.action}</span> · #{e.id}
                </span>
              </span>
              {expandable && <ChevronRight className={clsx('mt-1 size-4 shrink-0 text-ink-3 transition-transform', isOpen && 'rotate-90')} />}
            </button>
            {isOpen && (
              <div className="px-5 pb-4 pl-15">
                <Diff before={e.before} after={e.after} />
                <div className="mt-2 text-xs text-ink-3">
                  {e.ip && <>From {e.ip} · </>}Entry hash <span className="font-mono">{e.hash.slice(0, 16)}…</span>
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
