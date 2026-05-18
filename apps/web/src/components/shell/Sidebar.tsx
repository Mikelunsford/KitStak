import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Boxes,
  BarChart3,
  ChevronDown,
  ChevronRight,
  Factory,
  Home,
  PackageOpen,
  Truck,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';

import { useOrgFlags } from '@/lib/hooks/useOrgFlags';

/**
 * Sidebar. five-pillar IA in order: 3PL Operations, Manufacturing,
 * Co-Pack and Ecom, KitForce, KitCost. Each pillar shows its children
 * only when the matching `plugins.<pillar>` flag is on for the active
 * org. The bundle gate is driven by `useOrgFlags()` which reads the live
 * org_feature_flags table via settings-api.
 *
 * Below the `md:` breakpoint this renders as a slide-in drawer driven by
 * AppShell. At md and above it stays a fixed `w-56` rail.
 */

interface PillarChild {
  to: string;
  label: string;
  icon: LucideIcon;
}

interface Pillar {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Feature-flag key from org_feature_flags. Bundle gate. */
  flag: string;
  children: PillarChild[];
}

const PILLARS: ReadonlyArray<Pillar> = [
  {
    key: 'three_pl',
    label: '3PL OPERATIONS',
    icon: PackageOpen,
    flag: 'plugins.three_pl',
    children: [
      { to: '/three-pl/receiving', label: 'Receiving', icon: PackageOpen },
      { to: '/three-pl/shipments', label: 'Shipments', icon: Truck },
    ],
  },
  {
    key: 'manufacturing',
    label: 'MANUFACTURING',
    icon: Factory,
    flag: 'plugins.manufacturing',
    children: [
      { to: '/manufacturing/runs', label: 'Production runs', icon: Factory },
    ],
  },
  {
    key: 'copack_ecom',
    label: 'CO-PACK AND ECOM',
    icon: Boxes,
    flag: 'plugins.copack_ecom',
    children: [
      { to: '/copack/orders', label: 'Channel orders', icon: Boxes },
    ],
  },
  {
    key: 'kitforce',
    label: 'KITFORCE',
    icon: Users,
    flag: 'plugins.kitforce',
    children: [
      { to: '/kitforce/labor', label: 'Labor', icon: Users },
    ],
  },
  {
    key: 'kitcost',
    label: 'KITCOST',
    icon: Wallet,
    flag: 'plugins.kitcost',
    children: [
      { to: '/kitcost/dashboard', label: 'Cost dashboard', icon: BarChart3 },
    ],
  },
];

const STORAGE_KEY = 'kitstak.sidebar.openCategories.v1';

function readPersistedOpen(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === 'string'));
  } catch {
    return new Set();
  }
}

function writePersistedOpen(open: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...open]));
  } catch {
    // localStorage may be unavailable; fail silent.
  }
}

function findActivePillar(pathname: string): string | null {
  for (const pillar of PILLARS) {
    for (const child of pillar.children) {
      if (pathname === child.to || pathname.startsWith(`${child.to}/`)) {
        return pillar.key;
      }
    }
  }
  return null;
}

function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

export interface SidebarProps {
  mobileOpen?: boolean;
  onClose?: () => void;
}

export function Sidebar({ mobileOpen = false, onClose }: SidebarProps = {}) {
  const orgFlags = useOrgFlags();
  const flags = orgFlags.data;
  const { pathname } = useLocation();
  const activePillar = useMemo(() => findActivePillar(pathname), [pathname]);

  const [openCategories, setOpenCategories] = useState<Set<string>>(() => {
    const persisted = readPersistedOpen();
    if (activePillar) persisted.add(activePillar);
    return persisted;
  });

  useEffect(() => {
    if (!activePillar) return;
    setOpenCategories((prev) => {
      if (prev.has(activePillar)) return prev;
      const next = new Set(prev);
      next.add(activePillar);
      writePersistedOpen(next);
      return next;
    });
  }, [activePillar]);

  const toggle = (key: string) => {
    setOpenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writePersistedOpen(next);
      return next;
    });
  };

  const onNavClick = () => {
    if (onClose) onClose();
  };

  const navContent = (
    <>
      <NavLink
        to="/dashboard"
        end
        onClick={onNavClick}
        className={({ isActive }) =>
          cn(
            'flex items-center gap-2 px-3 py-2 text-sm font-sans tracking-wide',
            isActive
              ? 'bg-bg-2 text-ink border-l-2 border-accent'
              : 'text-ink-dim hover:bg-bg-2 hover:text-ink',
          )
        }
      >
        <Home className="h-4 w-4" />
        DASHBOARD
      </NavLink>

      {PILLARS.map((pillar) => {
        const isOn = flags[pillar.flag] === true;
        const isOpen = openCategories.has(pillar.key);
        const Icon = pillar.icon;
        return (
          <div key={pillar.key} className="flex flex-col">
            <button
              type="button"
              onClick={() => toggle(pillar.key)}
              aria-expanded={isOpen}
              disabled={!isOn}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-display tracking-wider',
                activePillar === pillar.key
                  ? 'bg-bg-2 text-ink'
                  : 'text-ink-dim hover:bg-bg-2 hover:text-ink',
                !isOn && 'opacity-50 cursor-not-allowed',
              )}
              title={isOn ? undefined : 'Pillar not enabled for this workspace.'}
            >
              {isOpen ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0" />
              )}
              <Icon className="h-4 w-4" />
              <span className="flex-1">{pillar.label}</span>
            </button>
            {isOn && isOpen && (
              <div className="ml-6 flex flex-col border-l border-line pl-2">
                {pillar.children.map((child) => {
                  const ChildIcon = child.icon;
                  return (
                    <NavLink
                      key={child.to}
                      to={child.to}
                      onClick={onNavClick}
                      className={({ isActive }) =>
                        cn(
                          'flex items-center gap-2 px-2 py-1.5 text-xs font-sans tracking-wide',
                          isActive
                            ? 'text-ink'
                            : 'text-ink-dim hover:text-ink',
                        )
                      }
                    >
                      <ChildIcon className="h-3.5 w-3.5" />
                      {child.label}
                    </NavLink>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </>
  );

  return (
    <>
      {mobileOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={onClose}
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
        />
      ) : null}

      <nav
        className="hidden w-56 flex-col gap-0.5 overflow-y-auto border-r border-line bg-bg px-2 py-4 md:flex"
        aria-label="Primary"
      >
        {navContent}
      </nav>

      <nav
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-line bg-bg shadow-xl transition-transform duration-200 md:hidden',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-label="Primary navigation"
        aria-hidden={!mobileOpen}
      >
        <div className="flex items-center justify-end px-3 pt-4">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="p-1 text-ink-dim hover:bg-bg-2 hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-4 pt-2">
          {navContent}
        </div>
      </nav>
    </>
  );
}
