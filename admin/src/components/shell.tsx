'use client';

import clsx from 'clsx';
import {
  Activity,
  Award,
  BarChart3,
  Boxes,
  ClipboardCheck,
  Cpu,
  HandCoins,
  Settings as SettingsIcon,
  Wallet,
  Zap,
  FileClock,
  Image as ImageIcon,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Search,
  ShieldCheck,
  ShoppingBasket,
  Siren,
  Sprout,
  Sun,
  Thermometer,
  UserCog,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState, useSyncExternalStore } from 'react';

import { api, useQuery } from '@/lib/api';
import { useLive } from '@/lib/live';

import { type Role, useMe } from './admin-context';
import { LiveDot } from './ui';

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  roles?: Role[];
  /** A cold room operator sees only the items marked for them (and only their rooms inside them). */
  operator?: boolean;
  badge?: 'incidents' | 'requests';
}

const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: 'Monitor',
    items: [
      { href: '/', label: 'Overview', icon: <LayoutDashboard className="size-4" />, operator: true },
      { href: '/rooms', label: 'Cold rooms', icon: <Thermometer className="size-4" />, operator: true },
      { href: '/incidents', label: 'Incidents', icon: <Siren className="size-4" />, badge: 'incidents', operator: true },
      { href: '/energy', label: 'Energy', icon: <Zap className="size-4" />, operator: true },
      { href: '/analytics', label: 'Analytics', icon: <BarChart3 className="size-4" /> },
    ],
  },
  {
    section: 'People & stock',
    items: [
      { href: '/farmers', label: 'Farmers & cooperatives', icon: <Users className="size-4" />, operator: true },
      { href: '/requests', label: 'Storage requests', icon: <ClipboardCheck className="size-4" />, badge: 'requests', operator: true },
      { href: '/stock', label: 'Inventory', icon: <Boxes className="size-4" />, operator: true },
      { href: '/collections', label: 'Collections & charges', icon: <Wallet className="size-4" />, operator: true },
      { href: '/people', label: 'Accounts', icon: <HandCoins className="size-4" /> },
      { href: '/certificates', label: 'Certificates', icon: <Award className="size-4" /> },
    ],
  },
  {
    section: 'Market',
    items: [
      { href: '/market', label: 'Listings & orders', icon: <ShoppingBasket className="size-4" /> },
      { href: '/photos', label: 'Photos', icon: <ImageIcon className="size-4" /> },
    ],
  },
  {
    section: 'System',
    items: [
      { href: '/firmware', label: 'Firmware', icon: <Cpu className="size-4" /> },
      { href: '/crops', label: 'Crop profiles', icon: <Sprout className="size-4" /> },
      { href: '/settings', label: 'Settings', icon: <SettingsIcon className="size-4" />, operator: true },
      { href: '/audit', label: 'Audit trail', icon: <FileClock className="size-4" /> },
      { href: '/staff', label: 'Staff', icon: <UserCog className="size-4" />, roles: ['superadmin'] },
    ],
  },
];

const ROLE_LABEL: Record<Role, string> = { superadmin: 'Super Admin / CEO', support: 'Support', operations: 'Operations', market: 'Market', operator: 'Cold room operator' };

// The theme lives on <html data-theme>, falling back to the computer's setting.
const themeListeners = new Set<() => void>();
function subscribeTheme(cb: () => void) {
  themeListeners.add(cb);
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', cb);
  return () => {
    themeListeners.delete(cb);
    mq.removeEventListener('change', cb);
  };
}
const isDark = () => {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
};

function ThemeToggle() {
  const dark = useSyncExternalStore(subscribeTheme, isDark, () => false);
  return (
    <button
      className="rounded-lg p-2 text-ink-3 hover:bg-surface-3 hover:text-ink"
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      onClick={() => {
        const next = dark ? 'light' : 'dark';
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem('hh-theme', next);
        } catch {
          /* private mode */
        }
        themeListeners.forEach((cb) => cb());
      }}
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

/** Ctrl+K / ⌘K: jump to any person, room, certificate, order or listing. */
function CommandPalette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [found, setFound] = useState<{ type: string; id: string; title: string; subtitle: string }[]>([]);
  const [active, setActive] = useState(0);
  const results = q.trim().length >= 2 ? found : [];

  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(async () => {
      try {
        const r = await api<{ results: typeof found }>(`search?q=${encodeURIComponent(q)}`);
        setFound(r.results);
        setActive(0);
      } catch {
        setFound([]);
      }
    }, 180);
    return () => clearTimeout(t);
  }, [q]);

  const go = (r: (typeof results)[number]) => {
    const href = { user: `/people/${r.id}`, room: `/rooms/${r.id}`, certificate: `/certificates/${r.id}`, order: `/market?order=${r.id}`, listing: `/market?listing=${r.id}` }[r.type] ?? '/';
    onClose();
    router.push(href);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh]" onClick={onClose}>
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-surface shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Search className="size-4 text-ink-3" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, results.length - 1));
              if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
              if (e.key === 'Enter' && results[active]) go(results[active]);
            }}
            placeholder="Search people, phone numbers, rooms, certificates, orders…"
            className="h-12 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
          />
          <kbd className="rounded border border-line px-1.5 text-xs text-ink-3">Esc</kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-2" role="listbox">
          {results.map((r, i) => (
            <li key={`${r.type}-${r.id}`} role="option" aria-selected={i === active}>
              <button
                onMouseEnter={() => setActive(i)}
                onClick={() => go(r)}
                className={clsx('flex w-full flex-col rounded-lg px-3 py-2 text-left', i === active ? 'bg-surface-3' : '')}
              >
                <span className="text-sm font-medium text-ink">{r.title}</span>
                <span className="text-[13px] text-ink-3">{r.subtitle}</span>
              </button>
            </li>
          ))}
          {q.trim().length >= 2 && !results.length && <li className="px-3 py-6 text-center text-sm text-ink-3">Nothing found</li>}
          {q.trim().length < 2 && <li className="px-3 py-6 text-center text-sm text-ink-3">Type at least 2 characters</li>}
        </ul>
      </div>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const me = useMe();
  const pathname = usePathname();
  const router = useRouter();
  const { connected } = useLive();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const incidents = useQuery<any[]>('incidents?state=open', { refreshMs: 30_000 });
  const requests = useQuery<any[]>('storage-requests', { refreshMs: 30_000 });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));
  const openIncidents = incidents.data?.length ?? 0;
  const waitingRequests = requests.data?.length ?? 0;

  const initials = me.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  const nav = (
    <nav className="flex h-full flex-col bg-nav text-nav-ink">
      <Link href="/" className="flex items-center gap-3 px-5 pb-5 pt-5" onClick={() => setMobileNav(false)}>
        <span className="flex size-9 items-center justify-center rounded-xl bg-white p-1 shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/mark.png" alt="" className="size-full" />
        </span>
        <span className="leading-tight">
          <span className="block text-[15px] font-semibold tracking-tight">Harvest Hold</span>
          <span className="block text-[11px] font-medium uppercase tracking-[0.14em] text-nav-ink-3">Admin · Rwanda</span>
        </span>
      </Link>
      <div className="thin-scroll flex-1 space-y-4 overflow-y-auto px-3 pb-4 text-nav-ink-2">
        {NAV.map((group) => {
          const items = group.items.filter((i) => (me.role === 'operator' ? i.operator : !i.roles || i.roles.includes(me.role) || me.role === 'superadmin'));
          if (!items.length) return null;
          return (
            <div key={group.section}>
              <div className="px-3 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-nav-ink-3">{group.section}</div>
              <ul className="space-y-px">
                {items.map((item) => {
                  const active = isActive(item.href);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={() => setMobileNav(false)}
                        aria-current={active ? 'page' : undefined}
                        className={clsx(
                          'relative flex items-center gap-3 rounded-lg px-3 py-[7px] text-[13.5px] transition-colors',
                          active ? 'bg-nav-active font-medium text-nav-ink' : 'hover:bg-nav-hover hover:text-nav-ink'
                        )}
                      >
                        {active && <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-nav-accent" aria-hidden />}
                        <span className={active ? 'text-nav-accent' : 'text-nav-ink-3'}>{item.icon}</span>
                        <span className="flex-1 truncate">{item.label}</span>
                        {item.badge === 'requests' && waitingRequests > 0 && (
                          <span className="min-w-5 rounded-full bg-warning px-1.5 text-center text-[11px] font-semibold text-white" aria-label={`${waitingRequests} waiting`}>
                            {waitingRequests}
                          </span>
                        )}
                        {item.badge === 'incidents' && openIncidents > 0 && (
                          <span className="min-w-5 rounded-full bg-critical px-1.5 text-center text-[11px] font-semibold text-white" aria-label={`${openIncidents} open`}>
                            {openIncidents}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
      <div className="border-t border-nav-line p-3">
        <Link href="/account" onClick={() => setMobileNav(false)} className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-nav-hover">
          <span className="flex size-8 items-center justify-center rounded-full bg-nav-accent/20 text-[12px] font-semibold text-nav-accent">{initials}</span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-[13px] font-medium text-nav-ink">{me.name}</span>
            <span className="flex items-center gap-1 text-[11.5px] text-nav-ink-3">
              <ShieldCheck className="size-3" />
              {ROLE_LABEL[me.role]}
            </span>
          </span>
        </Link>
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 lg:block">{nav}</aside>
      {mobileNav && (
        <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setMobileNav(false)}>
          <aside className="h-full w-72" onClick={(e) => e.stopPropagation()}>
            {nav}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface/85 px-4 backdrop-blur-md lg:px-8">
          <button className="rounded-lg p-2 text-ink-2 hover:bg-surface-3 lg:hidden" onClick={() => setMobileNav(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex h-9 w-full max-w-md items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 text-sm text-ink-3 transition-colors hover:border-line-strong hover:bg-surface"
          >
            <Search className="size-4" />
            <span className="flex-1 truncate text-left">Search people, rooms, certificates…</span>
            <kbd className="hidden rounded border border-line px-1.5 text-xs sm:inline">Ctrl K</kbd>
          </button>
          <div className="ml-auto flex items-center gap-2">
            <span title={connected ? 'Receiving live data' : 'Reconnecting to live data…'} className="hidden items-center gap-1.5 rounded-full border border-line px-2.5 py-1 sm:inline-flex">
              <Activity className="size-3.5 text-ink-3" />
              <LiveDot on={connected} label={connected ? 'Live' : 'Reconnecting'} />
            </span>
            <ThemeToggle />
            <button
              className="rounded-lg p-2 text-ink-3 hover:bg-surface-3 hover:text-ink"
              aria-label="Sign out"
              onClick={async () => {
                await api('auth/logout', { method: 'POST' }).catch(() => {});
                router.replace('/login');
              }}
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 lg:px-8 lg:py-7">{children}</main>
      </div>
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}
