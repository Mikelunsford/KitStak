import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown, ChevronRight, Home, Search, X } from 'lucide-react';

import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import type { RoleCode } from '@/lib/capabilities';
import {
  SIDEBAR_MODES,
  defaultOpenModeForRole,
  findActiveMode,
  filterRoutesByQuery,
  groupRoutesByDomain,
  isModeVisible,
  visibleRoutesForMode,
  type ModeKey,
} from './sidebarModes';

/**
 * Sidebar. Task-based IA (UI/UX reconfiguration, plan section 5). Eight
 * collapsible task sections (SELL, BUY, INVENTORY AND WAREHOUSE, PRODUCTION AND
 * FULFILLMENT, MONEY, WORKFORCE, INSIGHTS, SETTINGS), each shaped around what
 * operators do rather than the data model. Add-on surfaces fold into the task
 * group they belong to. This supersedes the Wave 12 pillar IA. See
 * sidebarModes.ts for the section-to-route mapping and rationale; the URLs of
 * underlying routes are unchanged.
 *
 * Per-route flag gating: add-on routes carry requiresFlag so the link hides when
 * the org lacks the plugin; a section with no visible routes is dropped. One task
 * group can therefore mix always-on spine routes with entitlement-gated add-on
 * routes. The constitutional 403 FEATURE_DISABLED / 404 bundle-gate API guards
 * are unchanged; this is a pure SPA render adjustment.
 *
 * Role scoping: each section is shown via isModeVisible. Most sections gate on a
 * broad read capability so read-only roles keep access; SETTINGS is owner/admin
 * only, folding the former Admin block (org, configuration, data) into the IA.
 *
 * Within a section, routes carry a `group` label (CRM, Invoicing, etc.); a
 * sub-header renders each time the group changes so a long section reads as
 * domains rather than a flat wall of links.
 *
 * Below the `md:` breakpoint this renders as a slide-in drawer driven by
 * AppShell. At md and above it stays a fixed `w-56` rail.
 */

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

function defaultExpanded(role: RoleCode | null): Set<ModeKey> {
  // First load: open the role's home task section (sales -> SELL, ops ->
  // INVENTORY, accounting -> MONEY, everyone else -> SELL). Other sections stay
  // collapsed until the operator opens one or navigates into it (findActiveMode
  // auto-expands the active section). This keeps the daily drivers one glance
  // away without opening the whole tree (spec diagnosis P2).
  return new Set<ModeKey>([defaultOpenModeForRole(role)]);
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

  const { role, can } = useCapabilities();
  const [query, setQuery] = useState('');

  const [expanded, setExpanded] = useState<Set<ModeKey>>(() => {
    const base = readPersistedExpanded() ?? defaultExpanded(role);
    // Immutable: never mutate the Set returned by the initializer source.
    return activeMode ? new Set<ModeKey>([...base, activeMode]) : base;
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

  // Recomputed every render (cheap: 8 sections, ~50 routes). Role-scope each
  // section (isModeVisible), then flag-filter its routes, drop any link the role
  // cannot read (per-route requiresCap via the same `can` predicate), and apply
  // the type-to-filter query. A section with no visible routes is dropped.
  const filteredSections = SIDEBAR_MODES.filter((mode) =>
    isModeVisible(mode, role, can),
  )
    .map((mode) => ({
      mode,
      routes: filterRoutesByQuery(visibleRoutesForMode(mode, flags, can), query),
    }))
    .filter((section) => section.routes.length > 0);

  const showDashboardLink =
    trimmedQuery === '' || 'dashboard'.includes(lowerQuery);

  const hasAnyMatch = showDashboardLink || filteredSections.length > 0;

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
