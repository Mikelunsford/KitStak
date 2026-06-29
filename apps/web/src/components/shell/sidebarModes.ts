// Task-based sidebar IA (UI/UX reconfiguration, plan section 5).
//
// The sidebar moves from pillar-grouped sections (one always-on SPINE backbone
// plus one section per lit add-on) to eight task groups shaped around what
// operators do: SELL, BUY, INVENTORY AND WAREHOUSE, PRODUCTION AND FULFILLMENT,
// MONEY, WORKFORCE, INSIGHTS, SETTINGS. Each add-on surface folds into the task
// group it belongs to and renders only when the org is entitled and the user's
// role permits. This SUPERSEDES the Wave 12 pillar IA (which itself superseded
// the UX-Q1 six-job-mode decision).
//
// The change is sidebar-only. This file is fully decoupled from the route table
// (it does not import routes.ts), URLs do not change, and the flat ROUTES table
// stays the single source of truth (CLAUDE.md "flat ROUTES table" rule). A route
// can sit in a different task group from its URL prefix: catalog Items live under
// INVENTORY, the commercial 3PL surfaces live under PRODUCTION AND FULFILLMENT,
// and the admin surfaces live under SETTINGS, all without moving a single path.
//
// Gating is layered and orthogonal:
//   - Per-route `requiresFlag` keeps the existing SPA render gate: an add-on link
//     hides when the org lacks the plugin. Because each route keeps its own flag,
//     one task group can mix always-on spine routes with entitlement-gated add-on
//     routes (INVENTORY shows catalog + stock always, plus WMS bins and 3PL
//     receiving only when those add-ons are on). A group with zero visible routes
//     is dropped by the Sidebar.
//   - Per-section `requiresAnyCap` is a role-scope render gate: the section shows
//     only when the user holds at least one of the listed read capabilities. The
//     caps chosen are the broad read caps every internal role already has for the
//     domain, so a viewer keeps read access; only genuinely role-restricted areas
//     (WORKFORCE) drop for roles without any read there (sales, viewer).
//   - Per-route `requiresCap` is a finer role-scope render gate layered on top of
//     the section gate: each nav entry hides when the user lacks that entry's own
//     read capability, so a section that a role can open still drops the specific
//     links that role cannot read (a viewer keeps Customers but loses any link
//     whose read cap the viewer does not hold). Routes without a clear read cap
//     (add-on action-only resources, PUTAWAY, every SETTINGS entry) leave it
//     undefined and ride on the section gate alone.
//   - SETTINGS sets `adminOnly`, mirroring the prior owner/admin Admin block and
//     the AdminProtectedRoute guard on /admin/*.
//
// The constitutional 403 FEATURE_DISABLED / 404 bundle-gate API guards are
// unaffected; the server stays the authority. This is a pure SPA render
// adjustment for button and link hiding only.

import {
  ArrowLeftRight,
  Blocks,
  BookOpen,
  Boxes,
  Briefcase,
  Building,
  Building2,
  CalendarCheck,
  Calculator,
  ClipboardList,
  Clock,
  Contact,
  CreditCard,
  DollarSign,
  Download,
  Factory,
  FileMinus,
  FileSpreadsheet,
  FileText,
  Flag,
  Hammer,
  HardHat,
  Hash,
  KeyRound,
  Layers,
  Lock,
  MapPin,
  MessageSquare,
  Package,
  PackageCheck,
  PackageOpen,
  PackagePlus,
  Palette,
  Receipt,
  ReceiptText,
  Settings,
  ShoppingCart,
  SlidersHorizontal,
  Sparkles,
  Store,
  Tags,
  Target,
  Truck,
  TrendingUp,
  Upload,
  UserCog,
  Users,
  UsersRound,
  Wallet,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';

import { FEATURE_FLAGS } from '@/lib/constants';
import type { Capability, RoleCode } from '@/lib/capabilities';

export type ModeKey =
  | 'sell'
  | 'buy'
  | 'inventory'
  | 'production'
  | 'money'
  | 'workforce'
  | 'insights'
  | 'feedback'
  | 'settings';

export interface ModeRoute {
  path: string;
  label: string;
  icon: LucideIcon;
  /**
   * Optional domain sub-group label. Used inside a task section to render a
   * sub-header (e.g. "CRM", "Invoicing") above the routes that share it. Routes
   * are listed in group order; Sidebar.tsx emits a sub-header each time the group
   * changes. Single-domain sections (BUY, WORKFORCE, INSIGHTS) leave this
   * undefined and render flat.
   */
  group?: string;
  /**
   * Optional org_feature_flags.flag_key. When set, the route is hidden from the
   * sidebar when the flag is off for the active org. Existing pillar-level 403
   * FEATURE_DISABLED API guards are unaffected; this is a pure SPA render gate.
   */
  requiresFlag?: string;
  /**
   * Optional read capability key. Active per-route role-scope gate layered on top
   * of the section gate (ModeSpec.requiresAnyCap): when set, the nav entry hides
   * unless the active role holds this read capability, so a section a role can
   * open still drops the specific links that role cannot read. Undefined means no
   * per-route gate, so the entry rides on the section gate alone (used for add-on
   * action-only resources that expose no read cap, PUTAWAY, and SETTINGS entries).
   * SPA render hiding only; the server stays the authority.
   */
  requiresCap?: Capability;
}

export interface ModeSpec {
  key: ModeKey;
  /**
   * Section home route. The Sidebar renders the section label as a link to this
   * path (the Section Dashboard) while the caret toggles the inline sub-links.
   * Section Dashboards, Phase 1.
   */
  homePath: string;
  /** Branded uppercase label. */
  label: string;
  /** One-line description in plain English, period-ending. */
  subtitle: string;
  icon: LucideIcon;
  /**
   * When set, the section renders only if the active role holds at least one of
   * these capabilities. Undefined means no role gate (entitlement and per-route
   * flags still apply). Choose broad read caps so read-only roles keep access.
   */
  requiresAnyCap?: ReadonlyArray<Capability>;
  /** When true, the section renders only for org_owner / org_admin. */
  adminOnly?: boolean;
  routes: ReadonlyArray<ModeRoute>;
}

export const SIDEBAR_MODES: ReadonlyArray<ModeSpec> = [
  {
    key: 'sell',
    homePath: '/sell',
    label: 'SELL',
    subtitle: 'Win the work. Customers through quotes and projects.',
    icon: Target,
    // Two broad read caps both held by every internal role, so SELL stays
    // visible to all of them (Projects rides along; its read cap is implied).
    requiresAnyCap: ['crm.customers.read', 'quotes.quote.read'],
    routes: [
      // CRM
      { path: '/crm/customers', label: 'Customers', icon: Users, group: 'CRM', requiresCap: 'crm.customers.read' },
      { path: '/crm/contacts', label: 'Contacts', icon: Contact, group: 'CRM', requiresCap: 'crm.contacts.read' },
      { path: '/crm/leads', label: 'Leads', icon: TrendingUp, group: 'CRM', requiresCap: 'crm.leads.read' },
      { path: '/crm/opportunities', label: 'Opportunities', icon: Target, group: 'CRM', requiresCap: 'crm.opportunities.read' },
      { path: '/crm/activities', label: 'Activities', icon: CalendarCheck, group: 'CRM', requiresCap: 'crm.activities.read' },
      // Quotes
      { path: '/builder', label: 'Builder', icon: Hammer, group: 'Quotes', requiresCap: 'quotes.quote.read' },
      { path: '/estimates', label: 'Estimates', icon: Calculator, group: 'Quotes', requiresCap: 'quotes.quote.read' },
      { path: '/quotes', label: 'Quotes', icon: FileText, group: 'Quotes', requiresCap: 'quotes.quote.read' },
      // Projects
      { path: '/projects', label: 'Projects', icon: Briefcase, group: 'Projects', requiresCap: 'projects.project.read' },
    ],
  },
  {
    key: 'buy',
    homePath: '/buy',
    label: 'BUY',
    subtitle: 'Source and pay for what you bring in.',
    icon: ShoppingCart,
    requiresAnyCap: ['vendors.vendor.read'],
    routes: [
      { path: '/purchasing/vendors', label: 'Vendors', icon: Building2, requiresCap: 'vendors.vendor.read' },
      { path: '/purchasing/purchase-orders', label: 'Purchase orders', icon: Receipt, requiresCap: 'purchase_orders.purchase_order.read' },
      { path: '/purchasing/vendor-bills', label: 'Vendor bills', icon: ReceiptText, requiresCap: 'vendor_bills.vendor_bill.read' },
      { path: '/purchasing/expenses', label: 'Expenses', icon: CreditCard, requiresCap: 'expenses.expense.read' },
    ],
  },
  {
    key: 'inventory',
    homePath: '/inventory',
    label: 'INVENTORY AND WAREHOUSE',
    subtitle: 'Catalog, stock, receiving, and shipping.',
    icon: Warehouse,
    requiresAnyCap: ['warehouses.warehouse.read'],
    routes: [
      // Catalog
      { path: '/catalog/items', label: 'Items', icon: Package, group: 'Catalog', requiresCap: 'items.item.read' },
      { path: '/catalog/boms', label: 'Bills of materials', icon: Layers, group: 'Catalog', requiresCap: 'stock.bom.read' },
      { path: '/catalog/vas', label: 'Value-added services', icon: Sparkles, group: 'Catalog', requiresCap: 'vas.service.read' },
      // Stock
      { path: '/inventory/stock/levels', label: 'Stock levels', icon: Boxes, group: 'Stock', requiresCap: 'stock.level.read' },
      { path: '/inventory/stock/movements', label: 'Stock movements', icon: ArrowLeftRight, group: 'Stock', requiresCap: 'stock.movement.read' },
      // Warehouse
      { path: '/inventory/warehouses', label: 'Warehouses', icon: Warehouse, group: 'Warehouse', requiresCap: 'warehouses.warehouse.read' },
      {
        path: '/wms/locations',
        label: 'Locations',
        icon: MapPin,
        group: 'Warehouse',
        requiresFlag: FEATURE_FLAGS.PLUGINS_WMS,
        requiresCap: 'wms.location.read',
      },
      // WMS (warehouse execution, add-on six)
      {
        // No wms.putaway.read cap exists (putaway is a create/start action surface),
        // so this entry rides on the section gate and its plugin flag alone.
        path: '/wms/putaway',
        label: 'Putaway',
        icon: PackagePlus,
        group: 'WMS',
        requiresFlag: FEATURE_FLAGS.PLUGINS_WMS,
      },
      {
        path: '/wms/bin-stock',
        label: 'Bin stock',
        icon: Boxes,
        group: 'WMS',
        requiresFlag: FEATURE_FLAGS.PLUGINS_WMS,
        requiresCap: 'wms.bin_stock.read',
      },
      {
        path: '/wms/lots',
        label: 'Lots',
        icon: Tags,
        group: 'WMS',
        requiresFlag: FEATURE_FLAGS.PLUGINS_WMS,
        requiresCap: 'wms.lot.read',
      },
      // Receiving and shipping (3PL add-on)
      {
        path: '/3pl-operations/receiving',
        label: 'Receiving',
        icon: PackageOpen,
        group: 'Receiving and shipping',
        requiresFlag: FEATURE_FLAGS.PLUGINS_THREE_PL,
        requiresCap: 'receiving.order.read',
      },
      {
        path: '/3pl-operations/shipments',
        label: 'Shipments',
        icon: Truck,
        group: 'Receiving and shipping',
        requiresFlag: FEATURE_FLAGS.PLUGINS_THREE_PL,
        requiresCap: 'shipments.shipment.read',
      },
    ],
  },
  {
    key: 'production',
    homePath: '/production',
    label: 'PRODUCTION AND FULFILLMENT',
    subtitle: 'Build, kit, and fulfill the work.',
    icon: Factory,
    // No role gate: every route is entitlement-gated, so the section drops
    // entirely when the org runs no production or fulfillment add-on.
    routes: [
      // Manufacturing add-on
      {
        path: '/manufacturing/runs',
        label: 'Manufacturing runs',
        icon: Factory,
        group: 'Manufacturing',
        requiresFlag: FEATURE_FLAGS.PLUGINS_MANUFACTURING,
      },
      // Co-Pack and Ecom add-on
      {
        path: '/copack/orders',
        label: 'Sales orders',
        icon: ShoppingCart,
        group: 'Co-Pack and Ecom',
        requiresFlag: FEATURE_FLAGS.PLUGINS_COPACK_ECOM,
      },
      {
        path: '/copack/kitting',
        label: 'Kitting jobs',
        icon: Boxes,
        group: 'Co-Pack and Ecom',
        requiresFlag: FEATURE_FLAGS.PLUGINS_COPACK_ECOM,
      },
      {
        path: '/copack/fulfillments',
        label: 'Fulfillments',
        icon: PackageCheck,
        group: 'Co-Pack and Ecom',
        requiresFlag: FEATURE_FLAGS.PLUGINS_COPACK_ECOM,
      },
      {
        path: '/copack/channels',
        label: 'Sales channels',
        icon: Store,
        group: 'Co-Pack and Ecom',
        requiresFlag: FEATURE_FLAGS.PLUGINS_COPACK_ECOM,
      },
      // 3PL Operations commercial layer
      {
        path: '/3pl-operations/accounts',
        label: 'Accounts',
        icon: Building,
        group: '3PL Operations',
        requiresFlag: FEATURE_FLAGS.PLUGINS_THREE_PL,
      },
      {
        path: '/3pl-operations/job-builders',
        label: 'Job builders',
        icon: Blocks,
        group: '3PL Operations',
        requiresFlag: FEATURE_FLAGS.PLUGINS_THREE_PL,
      },
      {
        path: '/3pl-operations/supply-plans',
        label: 'Supply plans',
        icon: ClipboardList,
        group: '3PL Operations',
        requiresFlag: FEATURE_FLAGS.PLUGINS_THREE_PL,
      },
      {
        path: '/3pl-operations/job-runs',
        label: 'Job runs',
        icon: HardHat,
        group: '3PL Operations',
        requiresFlag: FEATURE_FLAGS.PLUGINS_THREE_PL,
      },
      {
        path: '/3pl-operations/job-builder',
        label: 'Job Builder',
        icon: PackagePlus,
        group: '3PL Operations',
        requiresFlag: FEATURE_FLAGS.PLUGINS_THREE_PL,
      },
      {
        path: '/3pl-operations/billing-reviews',
        label: 'Billing review',
        icon: Receipt,
        group: '3PL Operations',
        requiresFlag: FEATURE_FLAGS.PLUGINS_THREE_PL,
      },
    ],
  },
  {
    key: 'money',
    homePath: '/money',
    label: 'MONEY',
    subtitle: 'Invoices, payments, and the books.',
    icon: DollarSign,
    requiresAnyCap: ['invoices.read'],
    routes: [
      // Invoicing
      { path: '/invoicing/invoices', label: 'Invoices', icon: FileSpreadsheet, group: 'Invoicing', requiresCap: 'invoices.read' },
      { path: '/invoicing/payments', label: 'Payments', icon: DollarSign, group: 'Invoicing', requiresCap: 'payments.read' },
      { path: '/invoicing/credit-notes', label: 'Credit notes', icon: FileMinus, group: 'Invoicing', requiresCap: 'credit_notes.read' },
      // Finance
      { path: '/finance/coa', label: 'Chart of accounts', icon: Wallet, group: 'Finance', requiresCap: 'coa.read' },
      { path: '/finance/period-close', label: 'Period close', icon: Lock, group: 'Finance', requiresCap: 'period_close.read' },
      {
        path: '/finance/journal-entries',
        label: 'Journal entries',
        icon: BookOpen,
        group: 'Finance',
        requiresFlag: FEATURE_FLAGS.FINANCE_JOURNAL_ENTRIES_ENABLED,
        requiresCap: 'journal_entries.read',
      },
    ],
  },
  {
    key: 'workforce',
    homePath: '/workforce',
    label: 'WORKFORCE',
    subtitle: 'People, schedules, and labor.',
    icon: HardHat,
    requiresAnyCap: ['kitforce.member.read'],
    routes: [
      {
        path: '/kitforce/members',
        label: 'Members',
        icon: UsersRound,
        requiresFlag: FEATURE_FLAGS.PLUGINS_KITFORCE,
        requiresCap: 'kitforce.member.read',
      },
      {
        path: '/kitforce/teams',
        label: 'Teams',
        icon: UserCog,
        requiresFlag: FEATURE_FLAGS.PLUGINS_KITFORCE,
        requiresCap: 'kitforce.team.read',
      },
      {
        path: '/kitforce/shifts',
        label: 'Schedule',
        icon: CalendarCheck,
        requiresFlag: FEATURE_FLAGS.PLUGINS_KITFORCE,
        requiresCap: 'kitforce.shift.read',
      },
      {
        path: '/kitforce/assignments',
        label: 'Assignments',
        icon: ClipboardList,
        requiresFlag: FEATURE_FLAGS.PLUGINS_KITFORCE,
        requiresCap: 'kitforce.assignment.read',
      },
      {
        path: '/kitforce/time-entries',
        label: 'Time entries',
        icon: Clock,
        requiresFlag: FEATURE_FLAGS.PLUGINS_KITFORCE,
        requiresCap: 'kitforce.time_entry.read',
      },
    ],
  },
  {
    key: 'insights',
    homePath: '/insights',
    label: 'INSIGHTS',
    subtitle: 'Cost, margin, and profitability.',
    icon: TrendingUp,
    requiresAnyCap: ['kitcost.dashboard.view', 'threepl.profitability.read'],
    routes: [
      {
        path: '/kitcost/dashboard',
        label: 'Cost dashboard',
        icon: DollarSign,
        requiresFlag: FEATURE_FLAGS.PLUGINS_KITCOST,
        requiresCap: 'kitcost.dashboard.view',
      },
      {
        path: '/3pl-operations/profitability',
        label: 'Profitability',
        icon: TrendingUp,
        requiresFlag: FEATURE_FLAGS.PLUGINS_THREE_PL,
        requiresCap: 'threepl.profitability.read',
      },
    ],
  },
  {
    key: 'feedback',
    homePath: '/feedback/tickets',
    label: 'FEEDBACK',
    subtitle: 'Send feedback and track your tickets.',
    icon: MessageSquare,
    // support.ticket.create is held by every internal role (and customer
    // portal), so FEEDBACK shows for everyone who can file. The staff inbox
    // route below is additionally gated by the platform-staff probe in
    // Sidebar.tsx.
    requiresAnyCap: ['support.ticket.create'],
    routes: [
      {
        path: '/feedback/tickets',
        label: 'My feedback',
        icon: MessageSquare,
        requiresCap: 'support.ticket.create',
      },
    ],
  },
  {
    key: 'settings',
    homePath: '/settings',
    label: 'SETTINGS',
    subtitle: 'Configure the org and your team.',
    icon: Settings,
    adminOnly: true,
    routes: [
      // Organization
      { path: '/admin/settings', label: 'Organization', icon: Building2, group: 'Organization' },
      { path: '/admin/members', label: 'Members', icon: Users, group: 'Organization' },
      { path: '/admin/sso', label: 'Single sign-on', icon: KeyRound, group: 'Organization' },
      { path: '/admin/billing', label: 'Billing', icon: CreditCard, group: 'Organization' },
      // Configuration
      {
        path: '/settings/sales-config/taxes',
        label: 'Sales config',
        icon: SlidersHorizontal,
        group: 'Configuration',
      },
      { path: '/settings/rate-cards', label: 'Rate card', icon: DollarSign, group: 'Configuration' },
      { path: '/admin/branding', label: 'Branding', icon: Palette, group: 'Configuration' },
      { path: '/admin/numbering', label: 'Numbering', icon: Hash, group: 'Configuration' },
      { path: '/admin/flags', label: 'Feature flags', icon: Flag, group: 'Configuration' },
      // Data
      { path: '/imports', label: 'Imports', icon: Upload, group: 'Data' },
      { path: '/exports', label: 'Exports', icon: Download, group: 'Data' },
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
 * Compute whether a route passes its per-route role-scope gate. Routes without
 * `requiresCap` are always cap-visible (they ride on the section gate); routes
 * with one show only when the active role holds that read capability. Pure, so
 * the per-route role-scope rule is unit-testable without a renderer.
 */
export function isRouteCapVisible(
  route: ModeRoute,
  can: (cap: Capability) => boolean,
): boolean {
  if (route.requiresCap === undefined) return true;
  return can(route.requiresCap);
}

/**
 * Return the routes inside a section that the operator should see, after
 * applying per-route flag gating and, when a capability predicate is supplied,
 * per-route role-scope gating. The `can` parameter is optional so callers that
 * gate only by entitlement (and the flag-only unit tests) keep flag-only
 * behavior; pass it to also drop links the active role cannot read.
 *
 */
export function visibleRoutesForMode(
  mode: ModeSpec,
  flags: Record<string, boolean>,
  can?: (cap: Capability) => boolean,
): ReadonlyArray<ModeRoute> {
  return mode.routes.filter(
    (r) => isRouteVisible(r, flags) && (can === undefined || isRouteCapVisible(r, can)),
  );
}

/**
 * Compute whether a task section should render for the active role. A section
 * with `adminOnly` shows only for org_owner / org_admin. A section with
 * `requiresAnyCap` shows only when the role holds at least one of those caps. A
 * section with neither is always role-visible (entitlement gating still applies
 * per route). Kept pure so the role-scope rule is unit-testable without a
 * renderer.
 */
export function isModeVisible(
  mode: ModeSpec,
  role: RoleCode | null,
  can: (cap: Capability) => boolean,
): boolean {
  if (mode.adminOnly === true) {
    return role === 'org_owner' || role === 'org_admin';
  }
  if (mode.requiresAnyCap === undefined) return true;
  return mode.requiresAnyCap.some((cap) => can(cap));
}

/**
 * The task section to open by default for a role on first load, so the operator
 * lands on their home domain rather than a closed wall. Sales opens SELL, ops
 * opens INVENTORY, accounting opens MONEY; owner, admin, viewer, and unknown
 * roles open SELL (the customers-through-cash backbone). The active section is
 * auto-expanded on top of this by the Sidebar.
 */
export function defaultOpenModeForRole(role: RoleCode | null): ModeKey {
  switch (role) {
    case 'ops':
      return 'inventory';
    case 'accounting':
      return 'money';
    case 'sales':
    default:
      return 'sell';
  }
}

/**
 * Filter an already-flag-filtered route list by a free-text query, matching
 * case-insensitively against the route label. A blank or whitespace-only query
 * returns the list unchanged. Kept pure so the sidebar type-to-filter matching
 * rule is unit-testable without rendering the Sidebar.
 */
export function filterRoutesByQuery(
  routes: ReadonlyArray<ModeRoute>,
  query: string,
): ReadonlyArray<ModeRoute> {
  const q = query.trim().toLowerCase();
  if (q === '') return routes;
  return routes.filter((route) => route.label.toLowerCase().includes(q));
}

export interface SidebarRouteGroup {
  /** Domain sub-group label, or undefined for ungrouped (flat) routes. */
  label: string | undefined;
  routes: ReadonlyArray<ModeRoute>;
}

/**
 * Collapse an ordered, already-flag-filtered route list into consecutive runs
 * that share a `group` label. Multi-domain sections split into one run per
 * sub-group (CRM, Catalog, ...); single-domain sections (no group) collect into
 * a single label-undefined run. Sidebar.tsx renders each labelled run as a
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
 * Find which section owns a pathname. Used by Sidebar to auto-expand the section
 * that contains the active route on first render.
 *
 * Matches by exact path or prefix-with-slash so deep-link nav (e.g. /quotes/:id
 * or /3pl-operations/accounts/:id) still highlights the right section.
 */
export function findActiveMode(pathname: string): ModeKey | null {
  for (const mode of SIDEBAR_MODES) {
    // The section home (e.g. /sell) highlights and auto-expands its section.
    if (pathname === mode.homePath) {
      return mode.key;
    }
    for (const route of mode.routes) {
      if (pathname === route.path || pathname.startsWith(`${route.path}/`)) {
        return mode.key;
      }
    }
  }
  return null;
}
