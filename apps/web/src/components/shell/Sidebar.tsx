import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  ArrowLeftRight,
  BarChart3,
  BookOpen,
  Boxes,
  Briefcase,
  Building2,
  CalendarCheck,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Contact,
  CreditCard,
  DollarSign,
  Download,
  Factory,
  FileMinus,
  FileSpreadsheet,
  FileText,
  Flag,
  Hash,
  Home,
  Package,
  PackageOpen,
  Palette,
  Receipt,
  Search,
  Settings,
  Target,
  TrendingUp,
  Truck,
  Upload,
  Users,
  Wallet,
  Warehouse,
  X,
  type LucideIcon,
} from 'lucide-react';

import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { FEATURE_FLAGS } from '@/lib/constants';
import { resolveSectionVisibility } from './sidebarGating';

/**
 * Sidebar. Navigation IA grouped into collapsible sections. Core sections
 * (Workspace, Sales, Procurement, Inventory, Finance, Tools, Admin) are
 * always rendered; admin and route-level guards still apply at the page
 * boundary. Pillar sections (3PL Operations, Manufacturing, Co-Pack and
 * Ecom, KitForce, KitCost) gate on `plugins.<pillar>` flags.
 *
 * Two gating postures (UX-Q3):
 *   - Sections with a flag default to "visible but disabled" when off,
 *     so the operator can see the surface and recognise the flip when
 *     it lights up. 3PL, Manufacturing, KitCost, and Finance use this.
 *   - Sections with `hideWhenOff: true` are omitted entirely when the
 *     flag is off. Co-Pack and KitForce use this so unbuilt pillars
 *     stop leaking into the first-impression sidebar; flipping the
 *     flag on later restores the section.
 *
 * The constitutional `403 FEATURE_DISABLED` API guard is unchanged --
 * this is a pure SPA-render adjustment.
 *
 * Below the `md:` breakpoint this renders as a slide-in drawer driven by
 * AppShell. At md and above it stays a fixed `w-56` rail.
 */

interface NavChild {
  to: string;
  label: string;
  icon: LucideIcon;
}

interface NavSection {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Optional `org_feature_flags.flag_key`. When set, the section is
   *  disabled (and children hidden) if the flag is off for the active org. */
  flag?: string;
  /** UX-Q3: when true AND the flag is off, omit the section instead
   *  of rendering it in the disabled state. Used for unbuilt pillars
   *  (Co-Pack, KitForce). */
  hideWhenOff?: boolean;
  children: NavChild[];
}

const CORE_SECTIONS: ReadonlyArray<NavSection> = [
  {
    key: 'workspace',
    label: 'WORKSPACE',
    icon: Users,
    children: [
      { to: '/crm/customers', label: 'Customers', icon: Users },
      { to: '/crm/contacts', label: 'Contacts', icon: Contact },
      { to: '/crm/leads', label: 'Leads', icon: TrendingUp },
      { to: '/crm/opportunities', label: 'Opportunities', icon: Target },
      { to: '/crm/activities', label: 'Activities', icon: CalendarCheck },
    ],
  },
  {
    key: 'sales',
    label: 'SALES',
    icon: FileText,
    children: [
      { to: '/3pl-operations/quotes', label: 'Quotes', icon: FileText },
      { to: '/3pl-operations/projects', label: 'Projects', icon: Briefcase },
      { to: '/invoicing/invoices', label: 'Invoices', icon: FileSpreadsheet },
      { to: '/invoicing/payments', label: 'Payments', icon: DollarSign },
      { to: '/invoicing/credit-notes', label: 'Credit notes', icon: FileMinus },
    ],
  },
  {
    key: 'procurement',
    label: 'PROCUREMENT',
    icon: Building2,
    children: [
      { to: '/3pl-operations/vendors', label: 'Vendors', icon: Building2 },
      { to: '/3pl-operations/purchase-orders', label: 'Purchase orders', icon: ClipboardList },
      { to: '/3pl-operations/vendor-bills', label: 'Vendor bills', icon: Receipt },
      { to: '/3pl-operations/expenses', label: 'Expenses', icon: CreditCard },
    ],
  },
  {
    key: 'inventory',
    label: 'INVENTORY',
    icon: Package,
    children: [
      { to: '/3pl-operations/items', label: 'Items', icon: Package },
      { to: '/3pl-operations/warehouses', label: 'Warehouses', icon: Warehouse },
      { to: '/3pl-operations/stock/levels', label: 'Stock levels', icon: BarChart3 },
      { to: '/3pl-operations/stock/movements', label: 'Stock movements', icon: ArrowLeftRight },
    ],
  },
  {
    key: 'finance',
    label: 'FINANCE',
    icon: Wallet,
    flag: FEATURE_FLAGS.FINANCE_JOURNAL_ENTRIES_ENABLED,
    children: [
      { to: '/finance/coa', label: 'Chart of accounts', icon: BookOpen },
      { to: '/finance/journal-entries', label: 'Journal entries', icon: Wallet },
      { to: '/finance/period-close', label: 'Period close', icon: CalendarCheck },
    ],
  },
  {
    key: 'tools',
    label: 'TOOLS',
    icon: Search,
    children: [
      { to: '/search', label: 'Search', icon: Search },
      { to: '/imports', label: 'Imports', icon: Upload },
      { to: '/exports', label: 'Exports', icon: Download },
    ],
  },
  {
    key: 'admin',
    label: 'ADMIN',
    icon: Settings,
    children: [
      { to: '/admin/settings', label: 'Settings', icon: Settings },
      { to: '/admin/branding', label: 'Branding', icon: Palette },
      { to: '/admin/flags', label: 'Feature flags', icon: Flag },
      { to: '/admin/numbering', label: 'Numbering', icon: Hash },
    ],
  },
];

const PILLAR_SECTIONS: ReadonlyArray<NavSection> = [
  {
    key: 'three_pl',
    label: '3PL OPERATIONS',
    icon: PackageOpen,
    flag: FEATURE_FLAGS.PLUGINS_THREE_PL,
    children: [
      { to: '/3pl-operations/receiving', label: 'Receiving', icon: PackageOpen },
      { to: '/3pl-operations/production', label: 'Production runs', icon: Factory },
      { to: '/3pl-operations/shipments', label: 'Shipments', icon: Truck },
    ],
  },
  {
    key: 'manufacturing',
    label: 'MANUFACTURING',
    icon: Factory,
    flag: FEATURE_FLAGS.PLUGINS_MANUFACTURING,
    children: [
      { to: '/manufacturing/runs', label: 'Production runs', icon: Factory },
    ],
  },
  {
    // UX-Q3: hide entirely when off. Co-Pack routes return 404 today;
    // omit from the first-impression sidebar until the pillar ships.
    key: 'copack_ecom',
    label: 'CO-PACK AND ECOM',
    icon: Boxes,
    flag: FEATURE_FLAGS.PLUGINS_COPACK_ECOM,
    hideWhenOff: true,
    children: [
      { to: '/copack/orders', label: 'Channel orders', icon: Boxes },
    ],
  },
  {
    // UX-Q3: hide entirely when off. KitForce routes return 404 today;
    // omit from the first-impression sidebar until the pillar ships.
    key: 'kitforce',
    label: 'KITFORCE',
    icon: Users,
    flag: FEATURE_FLAGS.PLUGINS_KITFORCE,
    hideWhenOff: true,
    children: [
      { to: '/kitforce/labor', label: 'Labor', icon: Users },
    ],
  },
  {
    key: 'kitcost',
    label: 'KITCOST',
    icon: Wallet,
    flag: FEATURE_FLAGS.PLUGINS_KITCOST,
    children: [
      { to: '/kitcost/dashboard', label: 'Cost dashboard', icon: BarChart3 },
    ],
  },
];

const ALL_SECTIONS: ReadonlyArray<NavSection> = [
  ...CORE_SECTIONS,
  ...PILLAR_SECTIONS,
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

function findActiveSection(pathname: string): string | null {
  for (const section of ALL_SECTIONS) {
    for (const child of section.children) {
      if (pathname === child.to || pathname.startsWith(`${child.to}/`)) {
        return section.key;
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
  const activeSection = useMemo(() => findActiveSection(pathname), [pathname]);

  const [openCategories, setOpenCategories] = useState<Set<string>>(() => {
    const persisted = readPersistedOpen();
    if (activeSection) persisted.add(activeSection);
    return persisted;
  });

  useEffect(() => {
    if (!activeSection) return;
    setOpenCategories((prev) => {
      if (prev.has(activeSection)) return prev;
      const next = new Set(prev);
      next.add(activeSection);
      writePersistedOpen(next);
      return next;
    });
  }, [activeSection]);

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

      {ALL_SECTIONS.map((section) => {
        const visibility = resolveSectionVisibility(section, flags);
        if (!visibility.visible) return null;
        const isOn = visibility.enabled;
        const isOpen = openCategories.has(section.key);
        const Icon = section.icon;
        const disabledTitle = section.flag?.startsWith('plugins.')
          ? 'Pillar not enabled for this workspace.'
          : 'Feature not enabled for this workspace.';
        return (
          <div key={section.key} className="flex flex-col">
            <button
              type="button"
              onClick={() => toggle(section.key)}
              aria-expanded={isOpen}
              disabled={!isOn}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-display tracking-wider',
                activeSection === section.key
                  ? 'bg-bg-2 text-ink'
                  : 'text-ink-dim hover:bg-bg-2 hover:text-ink',
                !isOn && 'opacity-50 cursor-not-allowed',
              )}
              title={isOn ? undefined : disabledTitle}
            >
              {isOpen ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0" />
              )}
              <Icon className="h-4 w-4" />
              <span className="flex-1">{section.label}</span>
            </button>
            {isOn && isOpen && (
              <div className="ml-6 flex flex-col border-l border-line pl-2">
                {section.children.map((child) => {
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
