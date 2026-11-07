'use client';

import { AdminProvider } from '@/components/admin-context';
import { Shell } from '@/components/shell';
import { LiveProvider } from '@/lib/live';

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminProvider>
      <LiveProvider>
        <Shell>{children}</Shell>
      </LiveProvider>
    </AdminProvider>
  );
}
