'use client';

import clsx from 'clsx';
import { AlertTriangle, Check, CheckCircle2, CircleHelp, Copy, Loader2, X } from 'lucide-react';
import Link from 'next/link';
import {
  type ButtonHTMLAttributes,
  createContext,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

import { errorMessage } from '@/lib/errors';

// ---------------------------------------------------------------- buttons

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-hover border border-transparent',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-surface-3',
  ghost: 'bg-transparent text-ink-2 hover:bg-surface-3 border border-transparent',
  danger: 'bg-critical text-white hover:opacity-90 border border-transparent',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  icon,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; loading?: boolean; icon?: ReactNode }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap',
        size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-9 px-3.5 text-sm',
        VARIANT[variant],
        className
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export function LinkButton({ href, children, icon, variant = 'secondary', size = 'md' }: { href: string; children: ReactNode; icon?: ReactNode; variant?: Variant; size?: 'sm' | 'md' }) {
  return (
    <Link
      href={href}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors whitespace-nowrap',
        size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-9 px-3.5 text-sm',
        VARIANT[variant]
      )}
    >
      {icon}
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------- surfaces

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={clsx('rounded-2xl border border-line bg-surface shadow-card', className)}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, actions, className }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={clsx('flex items-start justify-between gap-4 border-b border-line px-5 py-4', className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[13px] text-ink-3">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-[13px] text-ink-3">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- badges & status

export type Tone = 'neutral' | 'good' | 'warning' | 'critical' | 'info' | 'brand';

const TONE: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-ink-2',
  good: 'bg-good-soft text-good-ink',
  warning: 'bg-warning-soft text-warning-ink',
  critical: 'bg-critical-soft text-critical-ink',
  info: 'bg-info-soft text-info-ink',
  brand: 'bg-brand-soft text-brand-ink',
};

export function Badge({ tone = 'neutral', icon, children, className }: { tone?: Tone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', TONE[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

/** Freshness of stored crops: never color alone, always icon + word. */
export function FreshnessBadge({ value }: { value: string | null | undefined }) {
  if (value === 'fresh') return <Badge tone="good" icon={<CheckCircle2 className="size-3.5" />}>Kept fresh</Badge>;
  if (value === 'attention') return <Badge tone="warning" icon={<AlertTriangle className="size-3.5" />}>Check quality</Badge>;
  if (value === 'unknown') return <Badge tone="neutral" icon={<CircleHelp className="size-3.5" />}>No data</Badge>;
  return <span className="text-ink-3">–</span>;
}

export function LiveDot({ on, label }: { on: boolean; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
      <span className={clsx('inline-block size-2 rounded-full', on ? 'live-dot bg-good' : 'bg-ink-3')} aria-hidden />
      {label ?? (on ? 'Live' : 'Offline')}
    </span>
  );
}

// ---------------------------------------------------------------- figures

export function StatTile({
  label,
  value,
  sub,
  tone,
  href,
  icon,
  footer,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'good' | 'warning' | 'critical';
  href?: string;
  icon?: ReactNode;
  /** Extra visual under the figure (a distribution bar, a meter). */
  footer?: ReactNode;
}) {
  const body = (
    <Card className={clsx('group flex h-full flex-col p-4 transition-all', href && 'hover:-translate-y-px hover:border-line-strong hover:shadow-pop')}>
      <div className="flex items-center gap-2.5">
        {icon && (
          <span
            className={clsx(
              'flex size-8 shrink-0 items-center justify-center rounded-lg',
              tone === 'critical' ? 'bg-critical-soft text-critical-ink' : tone === 'warning' ? 'bg-warning-soft text-warning-ink' : 'bg-brand-soft text-brand-ink'
            )}
          >
            {icon}
          </span>
        )}
        <span className="min-w-0 truncate text-[13px] font-medium text-ink-3" title={label}>
          {label}
        </span>
      </div>
      <div className={clsx('mt-3 truncate text-2xl font-semibold leading-tight tracking-tight tabular', tone === 'critical' ? 'text-critical-ink' : tone === 'warning' ? 'text-warning-ink' : 'text-ink')}>{value}</div>
      {sub && <div className="mt-1 line-clamp-2 text-[13px] text-ink-3">{sub}</div>}
      {footer && <div className="mt-auto pt-3">{footer}</div>}
    </Card>
  );
  return href ? (
    <Link href={href} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  );
}

/**
 * Where a value sits against its safe range: a scale with the safe band shaded and a marker.
 * The range and the value are also written, so it never relies on color.
 */
export function RangeBar({ value, min, max, unit = '°C', pad = 3 }: { value: number | null | undefined; min: number; max: number; unit?: string; pad?: number }) {
  const lo = Math.min(min - pad, value ?? min);
  const hi = Math.max(max + pad, value ?? max);
  const pos = (v: number) => ((v - lo) / (hi - lo || 1)) * 100;
  const inside = value !== null && value !== undefined && value >= min && value <= max;
  return (
    <div className="relative pt-1" aria-hidden>
      <div className="relative h-1.5 rounded-full bg-surface-3">
        <div className="absolute inset-y-0 rounded-full bg-good/35" style={{ left: `${pos(min)}%`, width: `${pos(max) - pos(min)}%` }} />
        {value !== null && value !== undefined && (
          <div
            className={clsx('absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface shadow', inside ? 'bg-good' : 'bg-warning')}
            style={{ left: `${pos(value)}%` }}
          />
        )}
      </div>
      <div className="relative mt-1 h-4 text-[11px] text-ink-3 tabular">
        <span className="absolute -translate-x-1/2" style={{ left: `${pos(min)}%` }}>{min}{unit}</span>
        <span className="absolute -translate-x-1/2" style={{ left: `${pos(max)}%` }}>{max}{unit}</span>
      </div>
    </div>
  );
}

/** Thin fill bar (capacity, share). */
export function Meter({ value, max, tone = 'brand' }: { value: number; max: number; tone?: 'brand' | 'warning' | 'critical' }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
      <div className={clsx('h-full rounded-full', tone === 'critical' ? 'bg-critical' : tone === 'warning' ? 'bg-warning' : 'bg-brand')} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Room health 0–100 as a ring with the number inside. Grade is also written, never color alone. */
export function HealthRing({ score, size = 44 }: { score: number | null | undefined; size?: number }) {
  if (score === null || score === undefined) return <span className="text-ink-3">–</span>;
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  const color = score >= 85 ? 'var(--good)' : score >= 60 ? 'var(--warning)' : 'var(--critical)';
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Health ${score} out of 100`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth="4" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={`${(score / 100) * c} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize={size * 0.3} fontWeight="600" fill="var(--ink)">
        {score}
      </text>
    </svg>
  );
}

export const healthLabel = (score: number | null | undefined) => (score === null || score === undefined ? '–' : score >= 85 ? 'Good' : score >= 60 ? 'Watch' : 'Poor');

/** Tiny trend line, no axes. `fluid` stretches it to the container's width. */
export function Sparkline({ values, width = 120, height = 32, band, fluid }: { values: number[]; width?: number; height?: number; band?: [number, number]; fluid?: boolean }) {
  if (values.length < 2) return <div style={{ width: fluid ? '100%' : width, height }} />;
  const w = fluid ? 300 : width;
  const lo = Math.min(...values, band?.[0] ?? Infinity);
  const hi = Math.max(...values, band?.[1] ?? -Infinity);
  const span = hi - lo || 1;
  const x = (i: number) => (i / (values.length - 1)) * (w - 4) + 2;
  const y = (v: number) => height - 4 - ((v - lo) / span) * (height - 8);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = values[values.length - 1];
  return (
    <div className="relative" style={{ width: fluid ? '100%' : width, height }} aria-hidden>
      <svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="block">
        {band && <rect x={0} width={w} y={y(band[1])} height={Math.max(0, y(band[0]) - y(band[1]))} fill="var(--band)" />}
        <path d={`${d} L${x(values.length - 1)},${height} L${x(0)},${height} Z`} fill="var(--series-1)" opacity="0.07" />
        <path d={d} fill="none" stroke="var(--series-1)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      {/* End dot as HTML so it stays round when the line is stretched. */}
      <span
        className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-[var(--series-1)] box-content"
        style={{ left: `${(x(values.length - 1) / w) * 100}%`, top: y(last) }}
      />
    </div>
  );
}

// ---------------------------------------------------------------- states

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-3 text-ink-3">{icon}</div>}
      <div className="text-[15px] font-medium text-ink">{title}</div>
      {body && <div className="mt-1 max-w-md text-sm text-ink-3">{body}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-md bg-surface-3', className)} />;
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-critical/30 bg-critical-soft px-4 py-3 text-sm text-critical-ink">
      <span>{errorMessage(error)}</span>
      {onRetry && <Button size="sm" onClick={onRetry}>Retry</Button>}
    </div>
  );
}

// ---------------------------------------------------------------- forms

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-ink">
        {label}
      </label>
      {children}
      {error ? <p className="text-[13px] text-critical-ink">{error}</p> : hint ? <p className="text-[13px] text-ink-3">{hint}</p> : null}
    </div>
  );
}

const inputClass =
  'w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-focus focus:outline-none focus:ring-2 focus:ring-[var(--focus)]/20 disabled:opacity-60';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx(inputClass, 'h-9', props.className)} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={clsx(inputClass, 'min-h-[80px]', props.className)} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={clsx(inputClass, 'h-9 pr-8', className)}>
      {children}
    </select>
  );
}

/** Row of filter chips (one choice). */
export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div role="radiogroup" className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx('rounded-md px-3 py-1 text-[13px] font-medium transition-colors', value === o.value ? 'bg-surface text-ink shadow-card' : 'text-ink-3 hover:text-ink')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: string; count?: number }[] }) {
  return (
    <div role="tablist" className="flex gap-1 border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={clsx(
            '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
            value === t.value ? 'border-brand text-ink' : 'border-transparent text-ink-3 hover:text-ink'
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 rounded-full bg-surface-3 px-1.5 text-xs text-ink-2">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- tables

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx('overflow-x-auto', className)}>
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}
export function Th({ children, className, align }: { children?: ReactNode; className?: string; align?: 'right' | 'left' | 'center' }) {
  return (
    <th className={clsx('border-b border-line bg-surface-2 px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-ink-3', align === 'right' && 'text-right', align === 'center' && 'text-center', className)}>
      {children}
    </th>
  );
}
export function Td({ children, className, align }: { children?: ReactNode; className?: string; align?: 'right' | 'left' | 'center' }) {
  return <td className={clsx('border-b border-line px-4 py-3 align-middle text-ink', align === 'right' && 'text-right tabular', align === 'center' && 'text-center', className)}>{children}</td>;
}

// ---------------------------------------------------------------- dialogs

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={clsx('m-auto w-[calc(100%-32px)] rounded-2xl border border-line bg-surface p-0 text-ink shadow-pop backdrop:bg-black/40', wide ? 'max-w-3xl' : 'max-w-lg')}
    >
      {open && (
        <div>
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="text-base font-semibold">{title}</h2>
            <button onClick={onClose} className="rounded-md p-1 text-ink-3 hover:bg-surface-3" aria-label="Close">
              <X className="size-4" />
            </button>
          </div>
          <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

/**
 * Confirms an action that is recorded in the audit trail. Asks for a reason (or a note on how
 * identity was checked) when `reasonLabel` is set.
 */
function ActionDialogBody({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  danger,
  reasonLabel,
  reasonHint,
  minLength = 5,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  reasonLabel?: string;
  reasonHint?: string;
  minLength?: number;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const tooShort = !!reasonLabel && reason.trim().length < minLength;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={submit} loading={busy} disabled={tooShort}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm text-ink-2">
        {description}
        {reasonLabel && (
          <Field label={reasonLabel} hint={reasonHint ?? 'Kept in the audit trail.'} htmlFor={id}>
            <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </Field>
        )}
        {error && <p className="text-critical-ink">{error}</p>}
      </div>
    </Modal>
  );
}

/** Mounted only while open, so every opening starts empty. */
export function ActionDialog(props: Parameters<typeof ActionDialogBody>[0]) {
  return props.open ? <ActionDialogBody {...props} /> : null;
}

/** A secret shown once (temporary password, PIN, device token): copy it now, it cannot be seen again. */
export function SecretBox({ label, value, note }: { label: string; value: string; note?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl border border-warning/50 bg-warning-soft p-4">
      <div className="text-[13px] font-medium text-warning-ink">{label}</div>
      <div className="mt-2 flex items-center gap-2">
        <code className="flex-1 break-all rounded-lg border border-line bg-surface px-3 py-2 font-mono text-base text-ink">{value}</code>
        <Button
          size="sm"
          icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <p className="mt-2 text-[13px] text-ink-2">{note ?? 'Shown only once. It is not stored anywhere readable.'}</p>
    </div>
  );
}

// ---------------------------------------------------------------- toasts

const ToastContext = createContext<(msg: string, tone?: 'good' | 'critical') => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; msg: string; tone: 'good' | 'critical' }[]>([]);
  const show = useCallback((msg: string, tone: 'good' | 'critical' = 'good') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={clsx('pointer-events-auto flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm shadow-pop', t.tone === 'good' ? 'border-line bg-surface text-ink' : 'border-critical/40 bg-critical-soft text-critical-ink')}>
            {t.tone === 'good' ? <CheckCircle2 className="size-4 text-good" /> : <AlertTriangle className="size-4" />}
            {t.msg}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
