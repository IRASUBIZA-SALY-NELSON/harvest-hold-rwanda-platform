'use client';

import { KeyRound, Laptop } from 'lucide-react';

import { useMe } from '@/components/admin-context';
import { Badge, Button, Card, CardHeader, LinkButton, PageHeader, Skeleton, useToast } from '@/components/ui';
import { api, useQuery } from '@/lib/api';
import { ago, dateTime } from '@/lib/format';

export default function AccountPage() {
  const me = useMe();
  const sessions = useQuery<any[]>('auth/sessions');
  const toast = useToast();
  return (
    <>
      <PageHeader title="Your account" subtitle={`${me.name} · ${me.email} · ${me.role}`} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Sign-in security" />
          <div className="space-y-4 p-5 text-sm">
            <p className="text-ink-2">You sign in with your email and password. After 5 wrong passwords in a row the account locks until a superadmin unlocks it.</p>
            <LinkButton href="/login/password" icon={<KeyRound className="size-4" />}>Change password</LinkButton>
          </div>
        </Card>
        <Card>
          <CardHeader title="Where you are signed in" subtitle="End any session you don't recognise" />
          {!sessions.data ? <div className="p-5"><Skeleton className="h-20" /></div> : (
            <ul className="divide-y divide-line">
              {sessions.data.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-5 py-3">
                  <Laptop className="size-4 text-ink-3" />
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="truncate text-ink">{s.userAgent || 'Unknown browser'}</div>
                    <div className="text-[13px] text-ink-3">{s.ip || 'unknown address'} · since {dateTime(s.createdAt)} · active {ago(s.lastUsedAt)}</div>
                  </div>
                  {s.current ? <Badge tone="brand">This browser</Badge> : (
                    <Button size="sm" onClick={async () => { await api(`auth/sessions/${s.id}`, { method: 'DELETE' }); toast('Session ended'); await sessions.reload(); }}>End</Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
