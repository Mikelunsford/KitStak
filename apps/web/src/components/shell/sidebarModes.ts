// UX-Q1: job-mode sidebar IA. The sidebar collapses from 5 pillar
// entries to 5 work-mode entries that group existing routes by the
// stage of work the operator is doing, not by which pillar owns them.
//
// Operator decision locked 2026-05-21 (Kitstak_UX_Revision_Questions
// 2026-05-21.md, Q1):
//   - Job-mode nav over Orders-board.
//   - Manufacturing stays a pillar in dashboard tiles (Q2 = no), but
//     the sidebar reorg groups routes by workflow stage regardless of
//     pillar identity.
//
// URLs do NOT change. /manufacturing/runs stays at /manufacturing/runs.
// Only the nav grouping changes; the flat ROUTES table is untouched
// (per the constitutional "flat ROUTES table" rule in CLAUDE.md).
//
// Five modes, in workflow order:
//   1. SELL     — quote, qualify, and close work
//   2. MAKE     — build it. track the lines.
//   3. SHIP     — outbound and stock movements
//   4. GET PAID — invoice, collect, reconcile
//   5. LIBRARY  — reference data and procurement
//
// Where AP routes live: the spec's 5-mode constraint has no Buy mode,
// so purchase orders, vendor bills, and expenses sit in LIBRARY along
// with the rest of the procurement reference data. If a 6th BUY mode
// is ever justified, it would peel cleanly off LIBRARY. Documented
// in the PR body, not coded here.
//
// Customers live in LIBRARY by design: they persist independently of
// any one sale and behave more like reference data than transactional
// records. Leads / opportunities / activities are the SELL surface.

import {
  ArrowLeftRight,
  Briefcase,
  Building2,
  CalendarCheck,
  Contact,
  CreditCard,
  DollarSign,
  Factory,
  FileMinus,
  FileSpreadsheet,
  FileText,
  Package,
  PackageOpen,
  Receipt,
  Target,
  TrendingUp,
  Truck,
  Users,
  Wallet,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';

import { FEATURE_FLAGS } from '@/lib/constants';

export type ModeKey = 'sell' | 'make' | 'ship' | 'get_paid' | 'library';

export interface ModeRoute {
  path: string;
  label: string;
  icon: LucideIcon;
  /**
   * Optional org_feature_flags.flag_key. When set, the route is
   * hidden from the sidebar when the flag is off for the active org.
   * Existing pillar-level 403 FEATURE_DISABLED API guards are
   * unaffected; this is a pure SPA-render gate.
   */
  requiresFlag?: string;
  /**
   * Optional capability key. Reserved for future use; the current
   * sidebar does not filter on caps because the SPA already mirrors
   * the role policy at the link layer and the server is authority.
   */
  requiresCap?: string;
}

export interface ModeSpec {
  key: ModeKey;
  /** Branded uppercase label. */
  label: string;
  /** One-line description in plain English, period-ending. */
  subtitle: string;
  icon: LucideIcon;
  routes: ReadonlyArray<ModeRoute>;
}

export const SIDEBAR_MODES: ReadonlyArray<ModeSpec> = [
  {
    key: 'sell',
    label: 'SELL',
    subtitle: 'Quote, qualify, and close work.',
    icon: Target,
    routes: [
      { path: '/crm/leads', label: 'Leads', icon: TrendingUp },
      { path: '/crm/opportunities', label: 'Opportunities', icon: Target },
      { path: '/crm/activities', label: 'Activities', icon: CalendarCheck },
      { path: '/3pl-operations/quotes', label: 'Quotes', icon: FileText },
    ],
  },
  {
    key: 'make',
    label: 'MAKE',
    subtitle: 'Build it. Track the lines.',
    icon: Factory,
    routes: [
      { path: '/3pl-operations/projects', label: 'Projects', icon: Briefcase },
      {
        path: '/manufacturing/runs',
        label: 'Manufacturing runs',
        icon: Factory,
        requiresFlag: FEATURE_FLAGS.PLUGINS_MANUFACTURING,
      },
      // BNEW-2 (PR-A, 2026-05-22 v2 smoke): the legacy "Production runs"
      // entry at /3pl-operations/production was removed. It rendered an
      // older form (raw UUID inputs, no warehouse dropdown, no auto-number,
      // no item picker); the canonical surface is /manufacturing/runs.
      // The legacy routes stay registered as <Navigate> redirects in
      // routes.ts so deep links and bookmarks land on the new surface.
      // Follow-up: F-Wave9-LEGACY-PRODUCTION-ROUTE-RETIRE-01.
      {
        path: '/3pl-operations/receiving',
        label: 'Receiving',
        icon: PackageOpen,
      },
    ],
  },
  {
    key: 'ship',
    label: 'SHIP',
    subtitle: 'Outbound and stock movements.',
    icon: Truck,
    routes: [
      { path: '/3pl-operations/shipments', label: 'Shipments', icon: Truck },
      {
        path: '/3pl-operations/stock/levels',
        label: 'Stock levels',
        icon: Package,
      },
      {
        path: '/3pl-operations/stock/movements',
        label: 'Stock movements',
        icon: ArrowLeftRight,
      },
    ],
  },
  {
    key: 'get_paid',
    label: 'GET PAID',
    subtitle: 'Invoice, collect, reconcile.',
    icon: DollarSign,
    routes: [
      { path: '/invoicing/invoices', label: 'Invoices', icon: FileSpreadsheet },
      { path: '/invoicing/credit-notes', label: 'Credit notes', icon: FileMinus },
      { path: '/invoicing/payments', label: 'Payments', icon: DollarSign },
      { path: '/kitcost/dashboard', label: 'Cost dashboard', icon: DollarSign },
      { path: '/finance/coa', label: 'Chart of accounts', icon: Wallet },
      { path: '/finance/period-close', label: 'Period close', icon: Wallet },
      {
        path: '/finance/journal-entries',
        label: 'Journal entries',
        icon: Wallet,
        requiresFlag: FEATURE_FLAGS.FINANCE_JOURNAL_ENTRIES_ENABLED,
      },
    ],
  },
  {
    key: 'library',
    label: 'LIBRARY',
    subtitle: 'Reference data and procurement.',
    icon: Package,
    routes: [
      { path: '/crm/customers', label: 'Customers', icon: Users },
      { path: '/crm/contacts', label: 'Contacts', icon: Contact },
      { path: '/3pl-operations/items', label: 'Items', icon: Package },
      { path: '/3pl-operations/warehouses', label: 'Warehouses', icon: Warehouse },
      { path: '/3pl-operations/vendors', label: 'Vendors', icon: Building2 },
      {
        path: '/3pl-operations/purchase-orders',
        label: 'Purchase orders',
        icon: Receipt,
      },
      {
        path: '/3pl-operations/vendor-bills',
        label: 'Vendor bills',
        icon: Receipt,
      },
      { path: '/3pl-operations/expenses', label: 'Expenses', icon: CreditCard },
    ],
  },
] as const;

/**
 * Compute whether a flag-gated route should render given the active
 * org's flag map. Routes without `requiresFlag` are always visible.
 *
 * Mirrors the absent-key-is-off contract from `useOrgFlags`.
 */
export function isRouteVisible(
  route: ModeRoute,
  flags: Record<string, boolean>,
): boolean {
  if (route.requiresFlag === undefined) return true;
  return flags[route.requiresFlag] === true;
}

/**
 * Return the routes inside a mode that the operator should see, after
 * applying per-route flag gating.
 */
export function visibleRoutesForMode(
  mode: ModeSpec,
  flags: Record<string, boolean>,
): ReadonlyArray<ModeRoute> {
  return mode.routes.filter((r) => isRouteVisible(r, flags));
}

/**
 * Find which mode owns a pathname. Used by Sidebar to auto-expand the
 * mode that contains the active route on first render.
 *
 * Matches by exact path or prefix-with-slash, mirroring the v1
 * sidebar's behaviour so deep-link nav (e.g. /3pl-operations/quotes/:id)
 * still highlights the right mode.
 */
export function findActiveMode(pathname: string): ModeKey | null {
  for (const mode of SIDEBAR_MODES) {
    for (const route of mode.routes) {
      if (pathname === route.path || pathname.startsWith(`${route.path}/`)) {
        return mode.key;
      }
    }
  }
  return null;
}
