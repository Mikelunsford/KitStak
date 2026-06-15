// Pillar-grouped sidebar IA (Wave 12, plan section 5.5, decision D4).
//
// The sidebar moves from the six UX-Q1 job-modes (SELL, MAKE, SHIP, GET PAID,
// LIBRARY, WORKFORCE) to pillar-grouped sections that map onto the white-paper
// spine plus add-ons model: one always-on SPINE backbone section, then one
// section per lit add-on. This SUPERSEDES the UX-Q1 job-mode decision locked
// 2026-05-21 (Kitstak_UX_Revision_Questions 2026-05-21.md, Q1).
//
// The change is sidebar-only. This file is fully decoupled from the route
// table (it does not import routes.ts), URLs do not change, and the flat
// ROUTES table stays the single source of truth (CLAUDE.md "flat ROUTES table"
// rule). Old paths still resolve via SpineMoveRedirect.
//
// Sections, in order:
//   1. SPINE       — always on. The backbone every org gets: CRM, Quotes,
//                    Projects, Catalog, Inventory, Purchasing, Invoicing,
//                    Finance, Settings. Sub-grouped by domain (the `group`
//                    field on each route drives a sub-header in Sidebar.tsx).
//   2. 3PL OPS     — gated plugins.three_pl. The 3PL add-on commercial and
//                    execution surfaces (Accounts, Receiving, Shipments today;
//                    Job Builders / Job Runs / Supply Plans / Billing Review /
//                    Profitability land here as later A-phases ship).
//   3. MANUFACTURING — gated plugins.manufacturing.
//   4. CO-PACK AND ECOM — gated plugins.copack_ecom.
//   5. KITFORCE    — gated plugins.kitforce.
//   6. KITCOST     — gated plugins.kitcost.
//
// WMS (the sixth add-on, ADR 0002) is NOT built yet (no plugins.wms flag in
// code). Its section lands with the WMS body (plan phases B0 to B4).
//
// Per-route `requiresFlag` keeps the existing SPA-render gate: a link is hidden
// when the org lacks the plugin. The server-side bundle gates (404) and
// per-route FEATURE_DISABLED guards are unaffected; this is a pure render gate.

import {
  ArrowLeftRight,
  Blocks,
  Boxes,
  Briefcase,
  Building,
  Building2,
  BookOpen,
  CalendarCheck,
  ClipboardList,
  Clock,
  Contact,
  CreditCard,
  DollarSign,
  Factory,
  FileMinus,
  FileSpreadsheet,
  FileText,
  HardHat,
  Layers,
  LayoutGrid,
  Lock,
  Package,
  PackageCheck,
  PackageOpen,
  Receipt,
  ReceiptText,
  ShoppingCart,
  SlidersHorizontal,
  Sparkles,
  Store,
  Target,
  Truck,
  TrendingUp,
  UserCog,
  Users,
  UsersRound,
  Wallet,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';

import { FEATURE_FLAGS } from '@/lib/constants';

export type ModeKey =
  | 'spine'
  | 'three_pl'
  | 'manufacturing'
  | 'copack'
  | 'kitforce'
  | 'kitcost';

export interface ModeRoute {
  path: string;
  label: string;
  icon: LucideIcon;
  /**
   * Optional domain sub-group label. Used inside the SPINE section to render
   * a sub-header (e.g. "CRM", "Catalog") above the routes that share it.
   * Routes are listed in group order; Sidebar.tsx emits a sub-header each time
   * the group changes. Add-on sections leave this undefined and render flat.
   */
  group?: string;
  /**
   * Optional org_feature_flags.flag_key. When set, the route is hidden from
   * the sidebar when the flag is off for the active org. Existing pillar-level
   * 403 FEATURE_DISABLED API guards are unaffected; this is a pure SPA-render
   * gate.
   */
  requiresFlag?: string;
  /**
   * Optional capability key. Reserved for future use; the current sidebar does
   * not filter on caps because the SPA already mirrors the role policy at the
   * link layer and the server is authority.
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
    key: 'spine',
    label: 'SPINE',
    subtitle: 'The always-on backbone. Customers through cash.',
    icon: LayoutGrid,
    routes: [
      // CRM
      { path: '/crm/customers', label: 'Customers', icon: Users, group: 'CRM' },
      { path: '/crm/contacts', label: 'Contacts', icon: Contact, group: 'CRM' },
      { path: '/crm/leads', label: 'Leads', icon: TrendingUp, group: 'CRM' },
      { path: '/crm/opportunities', label: 'Opportunities', icon: Target, group: 'CRM' },
      { path: '/crm/activities', label: 'Activities', icon: CalendarCheck, group: 'CRM' },
      // Quotes
      { path: '/quotes', label: 'Quotes', icon: FileText, group: 'Quotes' },
      // Projects
      { path: '/projects', label: 'Projects', icon: Briefcase, group: 'Projects' },
      // Catalog
      { path: '/catalog/items', label: 'Items', icon: Package, group: 'Catalog' },
      { path: '/catalog/boms', label: 'Bills of materials', icon: Layers, group: 'Catalog' },
      { path: '/catalog/vas', label: 'Value-added services', icon: Sparkles, group: 'Catalog' },
      // Inventory
      { path: '/inventory/warehouses', label: 'Warehouses', icon: Warehouse, group: 'Inventory' },
      { path: '/inventory/stock/levels', label: 'Stock levels', icon: Boxes, group: 'Inventory' },
      { path: '/inventory/stock/movements', label: 'Stock movements', icon: ArrowLeftRight, group: 'Inventory' },
      // Purchasing
      { path: '/purchasing/vendors', label: 'Vendors', icon: Building2, group: 'Purchasing' },
      { path: '/purchasing/purchase-orders', label: 'Purchase orders', icon: Receipt, group: 'Purchasing' },
      { path: '/purchasing/vendor-bills', label: 'Vendor bills', icon: ReceiptText, group: 'Purchasing' },
      { path: '/purchasing/expenses', label: 'Expenses', icon: CreditCard, group: 'Purchasing' },
      // Invoicing
      { path: '/invoicing/invoices', label: 'Invoices', icon: FileSpreadsheet, group: 'Invoicing' },
      { path: '/invoicing/credit-notes', label: 'Credit notes', icon: FileMinus, group: 'Invoicing' },
      { path: '/invoicing/payments', label: 'Payments', icon: DollarSign, group: 'Invoicing' },
      // Finance
      { path: '/finance/coa', label: 'Chart of accounts', icon: Wallet, group: 'Finance' },
      { path: '/finance/period-close', label: 'Period close', icon: Lock, group: 'Finance' },
      {
        path: '/finance/journal-entries',
        label: 'Journal entries',
        icon: BookOpen,
        group: 'Finance',
        requiresFlag: FEATURE_FLAGS.FINANCE_JOURNAL_ENTRIES_ENABLED,
      },
      // Settings
      {
        path: '/settings/sales-config/taxes',
        label: 'Sales config',
        icon: SlidersHorizontal,
        group: 'Settings',
      },
    ],
  },
  {
    key: 'three_pl',
    label: '3PL OPERATIONS',
    subtitle: 'Accounts, job builders, receiving, and shipping.',
    icon: Truck,
    routes: [
      // Accounts is the Wave 12 commercial-layer entry (Phase A1); Job Builders
      // is the Phase A2 entry; Supply Plans is A5; Job Runs is A6; Billing Review
      // and Profitability are A7.
      {
        path: '/3pl-operations/accounts',
        label: 'Accounts',
        icon: Building,
        requiresFlag: FEATURE_FLAGS.PLUGINS_THREE_PL,
      },
      {
        path: '/3pl-operations/job-builders',
        label: 'Job Builders',
        icon: Blocks,
        requiresFlag: FEATURE_FLAGS.PLUGINS_THREE_PL,
      },
      {
        path: '/3pl-operations/supply-plans',
        label: 'Supply Plans',
        icon: ClipboardList,
        requiresFlag: FEATURE_FLAGS.PLUGINS_THREE_PL,
      },
      {
        path: '/3pl-operations/job-runs',
        label: 'Job Runs',
        icon: HardHat,
        requiresFlag: FEATURE_FLAGS.PLUGINS_THREE_PL,
      },
      {
        path: '/3pl-operations/billing-reviews',
        label: 'Billing Review',
        icon: Receipt,
        requiresFlag: FEATURE_FLAGS.PLUGINS_THREE_PL,
      },
      {
        path: '/3pl-operations/profitability',
        label: 'Profitability',
        icon: TrendingUp,
        requiresFlag: FEATURE_FLAGS.PLUGINS_THREE_PL,
      },
      {
        path: '/3pl-operations/receiving',
        label: 'Receiving',
        icon: PackageOpen,
        requiresFlag: FEATURE_FLAGS.PLUGINS_THREE_PL,
      },
      {
        path: '/3pl-operations/shipments',
        label: 'Shipments',
        icon: Truck,
        requiresFlag: FEATURE_FLAGS.PLUGINS_THREE_PL,
      },
    ],
  },
  {
    key: 'manufacturing',
    label: 'MANUFACTURING',
    subtitle: 'Production runs and the floor.',
    icon: Factory,
    routes: [
      {
        path: '/manufacturing/runs',
        label: 'Runs',
        icon: Factory,
        requiresFlag: FEATURE_FLAGS.PLUGINS_MANUFACTURING,
      },
    ],
  },
  {
    key: 'copack',
    label: 'CO-PACK AND ECOM',
    subtitle: 'Sales orders, kitting, and fulfillment.',
    icon: Boxes,
    routes: [
      {
        path: '/copack/orders',
        label: 'Sales orders',
        icon: ShoppingCart,
        requiresFlag: FEATURE_FLAGS.PLUGINS_COPACK_ECOM,
      },
      {
        path: '/copack/kitting',
        label: 'Kitting jobs',
        icon: Boxes,
        requiresFlag: FEATURE_FLAGS.PLUGINS_COPACK_ECOM,
      },
      {
        path: '/copack/fulfillments',
        label: 'Fulfillments',
        icon: PackageCheck,
        requiresFlag: FEATURE_FLAGS.PLUGINS_COPACK_ECOM,
      },
      {
        path: '/copack/channels',
        label: 'Sales channels',
        icon: Store,
        requiresFlag: FEATURE_FLAGS.PLUGINS_COPACK_ECOM,
      },
    ],
  },
  {
    key: 'kitforce',
    label: 'KITFORCE',
    subtitle: 'People, schedules, and labor.',
    icon: HardHat,
    routes: [
      {
        path: '/kitforce/members',
        label: 'Members',
        icon: UsersRound,
        requiresFlag: FEATURE_FLAGS.PLUGINS_KITFORCE,
      },
      {
        path: '/kitforce/teams',
        label: 'Teams',
        icon: UserCog,
        requiresFlag: FEATURE_FLAGS.PLUGINS_KITFORCE,
      },
      {
        path: '/kitforce/shifts',
        label: 'Schedule',
        icon: CalendarCheck,
        requiresFlag: FEATURE_FLAGS.PLUGINS_KITFORCE,
      },
      {
        path: '/kitforce/assignments',
        label: 'Assignments',
        icon: ClipboardList,
        requiresFlag: FEATURE_FLAGS.PLUGINS_KITFORCE,
      },
      {
        path: '/kitforce/time-entries',
        label: 'Time entries',
        icon: Clock,
        requiresFlag: FEATURE_FLAGS.PLUGINS_KITFORCE,
      },
    ],
  },
  {
    key: 'kitcost',
    label: 'KITCOST',
    subtitle: 'Cost and margin.',
    icon: DollarSign,
    routes: [
      {
        path: '/kitcost/dashboard',
        label: 'Cost dashboard',
        icon: DollarSign,
        requiresFlag: FEATURE_FLAGS.PLUGINS_KITCOST,
      },
    ],
  },
] as const;

/**
 * Compute whether a flag-gated route should render given the active org's flag
 * map. Routes without `requiresFlag` are always visible.
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
 * Return the routes inside a section that the operator should see, after
 * applying per-route flag gating.
 */
export function visibleRoutesForMode(
  mode: ModeSpec,
  flags: Record<string, boolean>,
): ReadonlyArray<ModeRoute> {
  return mode.routes.filter((r) => isRouteVisible(r, flags));
}

export interface SidebarRouteGroup {
  /** Domain sub-group label (SPINE), or undefined for ungrouped add-on routes. */
  label: string | undefined;
  routes: ReadonlyArray<ModeRoute>;
}

/**
 * Collapse an ordered, already-flag-filtered route list into consecutive runs
 * that share a `group` label. SPINE routes split into one run per domain (CRM,
 * Catalog, ...); add-on routes (no group) collect into a single
 * label-undefined run. Sidebar.tsx renders each labelled run as a
 * `role="group"` with `aria-label` so the domain sub-grouping is announced to
 * assistive tech, not just shown visually.
 */
export function groupRoutesByDomain(
  routes: ReadonlyArray<ModeRoute>,
): ReadonlyArray<SidebarRouteGroup> {
  const out: SidebarRouteGroup[] = [];
  for (const route of routes) {
    const last = out[out.length - 1];
    if (last && last.label === route.group) {
      last.routes = [...last.routes, route];
    } else {
      out.push({ label: route.group, routes: [route] });
    }
  }
  return out;
}

/**
 * Find which section owns a pathname. Used by Sidebar to auto-expand the
 * section that contains the active route on first render.
 *
 * Matches by exact path or prefix-with-slash so deep-link nav (e.g.
 * /quotes/:id or /3pl-operations/accounts/:id) still highlights the right
 * section.
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
