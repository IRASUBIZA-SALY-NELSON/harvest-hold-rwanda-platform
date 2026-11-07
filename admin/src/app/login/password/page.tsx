'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { AuthFrame } from '@/components/auth-frame';
import { Button, Field, Input } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

/** Required after a temporary password; also used from Account to change it. */
export default function ChangePassword() {
  const router = useRouter();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mismatch = confirm.length > 0 && next !== confirm;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) return;
    setBusy(true);
    setError(null);
    try {
      await api('auth/password', { method: 'POST', body: { current, next }, redirectOnAuth: false });
      router.replace('/');
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <AuthFrame title="Choose your password" subtitle="At least 12 characters, with letters and digits. Your other sessions will be signed out.">
      <form onSubmit={submit} method="post" className="space-y-4">
        <Field label="Current (temporary) password" htmlFor="current">
          <Input id="current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoFocus />
        </Field>
        <Field label="New password" htmlFor="next" hint={next ? `${next.length} characters` : undefined}>
          <Input id="next" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={12} />
        </Field>
        <Field label="Repeat new password" htmlFor="confirm" error={mismatch ? 'The two passwords differ.' : null}>
          <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </Field>
        {error && <p className="text-sm text-critical-ink">{error}</p>}
        <Button type="submit" variant="primary" loading={busy} disabled={!current || next.length < 12 || mismatch} className="w-full">
          Save password
        </Button>
      </form>
    </AuthFrame>
  );
}
