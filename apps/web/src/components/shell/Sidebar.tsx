import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  ChevronDown,
  ChevronRight,
  CreditCard,
  Download,
  Flag,
  Hash,
  Home,
  KeyRound,
  Palette,
  Search,
  Settings,
  Upload,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';

import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import {
  SIDEBAR_MODES,
  findActiveMode,
  filterRoutesByQuery,
  groupRoutesByDomain,
  visibleRoutesForMode,
  type ModeKey,
} from './sidebarModes';

/**
 * Sidebar. Pillar-grouped IA (Wave 12, plan section 5.5). A single always-on
 * SPINE section (sub-grouped by domain) followed by one collapsible section
 * per lit add-on (3PL Operations, Manufacturing, Co-Pack and Ecom, KitForce,
 * KitCost). This supersedes the UX-Q1 job-mode IA. See sidebarModes.ts for the
 * section-to-route mapping and rationale; the URLs of underlying routes are
 * unchanged.
 *
 * Per-route flag gating: add-on routes carry requiresFlag so the link hides
 * when the org lacks the plugin, and journal entries hide inside SPINE when
 * finance.journal_entries.enabled is off. The constitutional 403
 * FEATURE_DISABLED / 404 bundle-gate API guards are unchanged; this is a pure
 * SPA-render adjustment.
 *
 * Within the SPINE section, routes carry a `group` label (CRM, Catalog,
 * Inventory, etc.); a sub-header renders each time the group changes so the
 * long backbone list reads as domains rather than a flat wall of links.
 *
 * Below the `md:` breakpoint this renders as a slide-in drawer driven by
 * AppShell. At md and above it stays a fixed `w-56` rail. The Admin section
 * remains below the sections so settings stay reachable without being part of
 * the pillar IA.
 */

interface AdminLink {
  to: string;
  label: string;
  icon: LucideIcon;
}

const ADMIN_LINKS: ReadonlyArray<AdminLink> = [
  { to: '/admin/settings', label: 'Settings', icon: Settings },
  { to: '/admin/branding', label: 'Branding', icon: Palette },
  { to: '/admin/flags', label: 'Feature flags', icon: Flag },
  { to: '/admin/numbering', label: 'Numbering', icon: Hash },
  // F-Wave9-STAFF-INVITE-CHASSIS-01: /admin/members staff invite surface.
  { to: '/admin/members', label: 'Members', icon: Users },
  // R-W13-AUTH-01: /admin/sso single sign-on connection management.
  // AdminProtectedRoute restricts to org_owner / org_admin; org.sso.* caps
  // gate the buttons on the page itself.
  { to: '/admin/sso', label: 'Single sign-on', icon: KeyRound },
  // Stripe wiring (item 9): /admin/billing. AdminProtectedRoute already
  // restricts to org_owner / org_admin; the upcoming caps PR refines this
  // via org.billing.read (owner + admin). No SPA-side cap check needed --
  // the route guard is authoritative.
  { to: '/admin/billing', label: 'Billing', icon: CreditCard },
  { to: '/imports', label: 'Imports', icon: Upload },
  { to: '/exports', label: 'Exports', icon: Download },
];

const STORAGE_KEY = 'kitstak.sidebar.modes.expanded';

function readPersistedExpanded(): Set<ModeKey> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    // Derive the allow-list from SIDEBAR_MODES so a newly added section (wms
    // was previously omitted here) can never silently drop from persisted
    // state again.
    const valid = new Set<string>(SIDEBAR_MODES.map((m) => m.key));
    const filtered = parsed.filter(
      (v): v is ModeKey => typeof v === 'string' && valid.has(v),
    );
    return new Set(filtered);
  } catch {
    return null;
  }
}

function writePersistedExpanded(expanded: Set<ModeKey>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...expanded]));
  } catch {
    // localStorage may be unavailable; fail silent.
  }
}

function defaultExpanded(): Set<ModeKey> {
  // First load: open only the always-on SPINE backbone (the daily drivers:
  // Customers, Quotes, Invoices). Add-on sections stay collapsed until the
  // operator opens one or navigates into it (findActiveMode auto-expands the
  // active section). Replaces the prior open-everything default that buried the
  // most-used links behind a scroll (spec diagnosis P2).
  return new Set<ModeKey>(['spine']);
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
  const activeMode = useMemo(() => findActiveMode(pathname), [pathname]);

  const { role } = useCapabilities();
  const [query, setQuery] = useState('');

  const [expanded, setExpanded] = useState<Set<ModeKey>>(() => {
    const persisted = readPersistedExpanded();
    const base = persisted ?? defaultExpanded();
    if (activeMode) base.add(activeMode);
    return base;
  });

  useEffect(() => {
    if (!activeMode) return;
    setExpanded((prev) => {
      if (prev.has(activeMode)) return prev;
      const next = new Set(prev);
      next.add(activeMode);
      writePersistedExpanded(next);
      return next;
    });
  }, [activeMode]);

  const toggle = (key: ModeKey) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writePersistedExpanded(next);
      return next;
    });
  };

  const onNavClick = () => {
    if (onClose) onClose();
  };

  const trimmedQuery = query.trim();
  const lowerQuery = trimmedQuery.toLowerCase();
  const canSeeAdmin = role === 'org_owner' || role === 'org_admin';

  // Recomputed every render (cheap: 7 sections, ~40 routes). Mirrors the prior
  // inline section map, plus an optional label filter while the operator types.
  const filteredSections = SIDEBAR_MODES.map((mode) => ({
    mode,
    routes: filterRoutesByQuery(visibleRoutesForMode(mode, flags), query),
  })).filter((section) => section.routes.length > 0);

  const visibleAdminLinks = trimmedQuery
    ? ADMIN_LINKS.filter((link) =>
        link.label.toLowerCase().includes(lowerQuery),
      )
    : ADMIN_LINKS;

  const showDashboardLink =
    trimmedQuery === '' || 'dashboard'.includes(lowerQuery);

  const hasAnyMatch =
    showDashboardLink ||
    filteredSections.length > 0 ||
    (canSeeAdmin && visibleAdminLinks.length > 0);

  const navContent = (
    <>
      <div className="px-1 pb-1">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-dim" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter navigation"
            aria-label="Filter navigation"
            className="w-full border border-line bg-bg-2 py-1.5 pl-7 pr-2 text-xs font-sans text-ink placeholder:text-ink-dim focus:border-accent focus:outline-none"
          />
        </div>
      </div>

      {showDashboardLink && (
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
      )}

      {filteredSections.map(({ mode, routes }) => {
        const isOpen = trimmedQuery !== '' ? true : expanded.has(mode.key);
        const isActive = activeMode === mode.key;
        const Icon = mode.icon;
        return (
          <div key={mode.key} className="flex flex-col">
            <button
              type="button"
              onClick={() => toggle(mode.key)}
              aria-expanded={isOpen}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-left font-display text-base tracking-wider uppercase',
                isActive
                  ? 'bg-bg-2 text-ink border-l-2 border-accent'
                  : 'text-ink hover:bg-bg-2',
              )}
            >
              {isOpen ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0" />
              )}
              <Icon className="h-4 w-4" />
              <span className="flex-1 leading-tight">
                <span className="block">{mode.label}</span>
                <span className="block text-[10px] font-sans font-normal text-ink-dim tracking-normal normal-case">
                  {mode.subtitle}
                </span>
              </span>
            </button>
            {isOpen && (
              <div className="ml-6 flex flex-col border-l border-line pl-2">
                {groupRoutesByDomain(routes).map((grp, gi) => {
                  // SPINE domains render as a labelled role="group" with a
                  // sub-header so the backbone reads (and is announced to
                  // assistive tech) as CRM / Catalog / Inventory rather than
                  // one flat list. Add-on sections have no group label and
                  // render their links flat.
                  const labelled = grp.label !== undefined;
                  return (
                    <div
                      key={grp.label ?? `addon-${gi}`}
                      className="flex flex-col"
                      role={labelled ? 'group' : undefined}
                      aria-label={labelled ? grp.label : undefined}
                    >
                      {labelled ? (
                        <div
                          className={cn(
                            'px-2 pb-0.5 font-display text-[10px] tracking-wider uppercase text-ink-dim',
                            gi === 0 ? 'pt-0.5' : 'pt-2',
                          )}
                        >
                          {grp.label}
                        </div>
                      ) : null}
                      {grp.routes.map((route) => {
                        const RouteIcon = route.icon;
                        return (
                          <NavLink
                            key={route.path}
                            to={route.path}
                            onClick={onNavClick}
                            className={({ isActive }) =>
                              cn(
                                'flex items-center gap-2 px-2 py-1.5 text-xs font-sans tracking-wide',
                                isActive
                                  ? 'bg-accent/10 text-ink'
                                  : 'text-ink-dim hover:text-ink hover:bg-bg-2',
                              )
                            }
                          >
                            <RouteIcon className="h-3.5 w-3.5" />
                            {route.label}
                          </NavLink>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {canSeeAdmin && visibleAdminLinks.length > 0 && (
        <div className="mt-4 border-t border-line pt-4">
          <div className="px-3 pb-1 font-display text-xs tracking-wider uppercase text-ink-dim">
            Admin
          </div>
          {visibleAdminLinks.map((link) => {
            const LinkIcon = link.icon;
            return (
              <NavLink
                key={link.to}
                to={link.to}
                onClick={onNavClick}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 px-3 py-1.5 text-xs font-sans tracking-wide',
                    isActive
                      ? 'bg-accent/10 text-ink'
                      : 'text-ink-dim hover:text-ink hover:bg-bg-2',
                  )
                }
              >
                <LinkIcon className="h-3.5 w-3.5" />
                {link.label}
              </NavLink>
            );
          })}
        </div>
      )}

      {trimmedQuery !== '' && !hasAnyMatch && (
        <p className="px-3 py-2 text-xs font-sans text-ink-dim">
          No navigation items match your filter.
        </p>
      )}
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
