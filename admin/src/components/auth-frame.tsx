import { Sprout } from 'lucide-react';
import type { ReactNode } from 'react';

/** Centered card for the sign-in steps. */
export function AuthFrame({ title, subtitle, children, step }: { title: string; subtitle?: ReactNode; children: ReactNode; step?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-lg bg-brand text-white">
            <Sprout className="size-5" />
          </div>
          <div className="leading-tight">
            <div className="font-semibold text-ink">Harvest Hold</div>
            <div className="text-xs text-ink-3">Admin portal</div>
          </div>
        </div>
        {step && <div className="mb-2 text-xs font-medium uppercase tracking-wider text-ink-3">{step}</div>}
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-ink-2">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}
