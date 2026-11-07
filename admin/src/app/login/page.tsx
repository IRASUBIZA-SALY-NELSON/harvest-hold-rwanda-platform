'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { AuthFrame } from '@/components/auth-frame';
import { Button, Field, Input } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ next: 'password' | 'portal' }>('auth/login', { method: 'POST', body: { email, password }, redirectOnAuth: false });
      router.replace(r.next === 'password' ? '/login/password' : '/');
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <AuthFrame title="Sign in" subtitle="Staff access to cold rooms, farmers and the market.">
      <form onSubmit={submit} method="post" className="space-y-4">
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        {error && <p className="text-sm text-critical-ink">{error}</p>}
        <Button type="submit" variant="primary" loading={busy} className="w-full">
          Sign in
        </Button>
        <p className="text-center text-[13px] text-ink-3">After 5 failed attempts the account locks until another superadmin unlocks it.</p>
      </form>
    </AuthFrame>
  );
}
