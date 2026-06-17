// UI/UX reconfiguration (plan section 5): pin the task-based sidebar IA.
//
// Tests the pure SIDEBAR_MODES export plus its helpers (isRouteVisible,
// visibleRoutesForMode, isModeVisible, defaultOpenModeForRole, findActiveMode,
// groupRoutesByDomain, filterRoutesByQuery) without a React renderer (mirrors
// the precedent in sidebarGating.test.ts and featureFlagResolver.test.ts).
//
// This supersedes the Wave 12 pillar IA: the sidebar now has eight task sections
// (SELL, BUY, INVENTORY AND WAREHOUSE, PRODUCTION AND FULFILLMENT, MONEY,
// WORKFORCE, INSIGHTS, SETTINGS) with add-on surfaces folded into the task group
// they belong to. Role scoping is asserted against the real capability policy.

import { describe, it, expect } from 'vitest';
import { Factory, Target } from 'lucide-react';

import {
  SIDEBAR_MODES,
  isRouteVisible,
  isRouteCapVisible,
  visibleRoutesForMode,
  isModeVisible,
  defaultOpenModeForRole,
  filterRoutesByQuery,
  findActiveMode,
  groupRoutesByDomain,
  type ModeKey,
} from './sidebarModes';
import { FEATURE_FLAGS } from '@/lib/constants';
import { hasCap, type Capability, type RoleCode } from '@/lib/capabilities';

const ALL_ROLES: ReadonlyArray<RoleCode> = [
  'org_owner',
  'org_admin',
  'sales',
  'ops',
  'accounting',
  'viewer',
  'customer_user',
  'vendor_user',
];

/** Build a real capability predicate for a role from the canon policy. */
function canFor(role: RoleCode): (cap: Capability) => boolean {
  return (cap) => hasCap(role, cap);
}

describe('SIDEBAR_MODES shape (task-based IA)', () => {
  it('contains exactly eight task sections', () => {
    expect(SIDEBAR_MODES).toHaveLength(8);
  });

  it('sections are the eight task groups, in order', () => {
    const keys = SIDEBAR_MODES.map((m) => m.key);
    expect(keys).toEqual<ModeKey[]>([
      'sell',
      'buy',
      'inventory',
      'production',
      'money',
      'workforce',
      'insights',
      'settings',
    ]);
  });

  it('every section has at least one route', () => {
    for (const mode of SIDEBAR_MODES) {
      expect(mode.routes.length, `section ${mode.key}`).toBeGreaterThan(0);
    }
  });

  it('every section has a branded uppercase label and a period-ending subtitle', () => {
    for (const mode of SIDEBAR_MODES) {
      // No em dashes, no double-hyphens, no emojis (branding rules).
      expect(mode.label, `${mode.key} label`).toBe(mode.label.toUpperCase());
      expect(mode.subtitle, `${mode.key} subtitle`).toMatch(/\.$/);
      expect(mode.subtitle, `${mode.key} no em dash`).not.toMatch(/—/);
      expect(mode.subtitle, `${mode.key} no double hyphen`).not.toMatch(/--/);
      expect(mode.label, `${mode.key} label no em dash`).not.toMatch(/—/);
      expect(mode.label, `${mode.key} label no double hyphen`).not.toMatch(/--/);
    }
  });

  it('no duplicate routes across sections (every path lives in exactly one section)', () => {
    const allPaths: string[] = [];
    for (const mode of SIDEBAR_MODES) {
      for (const route of mode.routes) {
        allPaths.push(route.path);
      }
    }
    const dupes = allPaths.filter((p, i) => allPaths.indexOf(p) !== i);
    expect(dupes, `duplicate paths: ${dupes.join(', ')}`).toEqual([]);
  });
});

describe('SIDEBAR_MODES section contents (task-based IA)', () => {
  function pathsFor(key: ModeKey): string[] {
    const mode = SIDEBAR_MODES.find((m) => m.key === key);
    if (!mode) throw new Error(`section not found: ${key}`);
    return mode.routes.map((r) => r.path);
  }

  it('SELL holds CRM, Quotes, and Projects', () => {
    const paths = pathsFor('sell');
    expect(paths).toContain('/crm/customers');
    expect(paths).toContain('/crm/contacts');
    expect(paths).toContain('/crm/leads');
    expect(paths).toContain('/crm/opportunities');
    expect(paths).toContain('/crm/activities');
    expect(paths).toContain('/quotes');
    expect(paths).toContain('/projects');
  });

  it('BUY holds the purchasing surfaces, ungated', () => {
    const mode = SIDEBAR_MODES.find((m) => m.key === 'buy')!;
    const paths = mode.routes.map((r) => r.path);
    expect(paths).toEqual([
      '/purchasing/vendors',
      '/purchasing/purchase-orders',
      '/purchasing/vendor-bills',
      '/purchasing/expenses',
    ]);
    for (const route of mode.routes) {
      expect(route.requiresFlag, `gate on ${route.path}`).toBeUndefined();
    }
  });

  it('INVENTORY AND WAREHOUSE unifies catalog, stock, warehouse, WMS, and 3PL receiving/shipping', () => {
    const paths = pathsFor('inventory');
    // Catalog and stock are always-on spine surfaces.
    expect(paths).toContain('/catalog/items');
    expect(paths).toContain('/catalog/boms');
    expect(paths).toContain('/catalog/vas');
    expect(paths).toContain('/inventory/stock/levels');
    expect(paths).toContain('/inventory/stock/movements');
    expect(paths).toContain('/inventory/warehouses');
    // WMS add-on surfaces fold in here.
    expect(paths).toContain('/wms/locations');
    expect(paths).toContain('/wms/putaway');
    expect(paths).toContain('/wms/bin-stock');
    expect(paths).toContain('/wms/lots');
    // 3PL receiving and shipping fold in here.
    expect(paths).toContain('/3pl-operations/receiving');
    expect(paths).toContain('/3pl-operations/shipments');
  });

  it('INVENTORY WMS routes are gated plugins.wms and 3PL routes are gated plugins.three_pl', () => {
    const mode = SIDEBAR_MODES.find((m) => m.key === 'inventory')!;
    const flagFor = (path: string) =>
      mode.routes.find((r) => r.path === path)?.requiresFlag;
    expect(flagFor('/wms/locations')).toBe(FEATURE_FLAGS.PLUGINS_WMS);
    expect(flagFor('/wms/putaway')).toBe(FEATURE_FLAGS.PLUGINS_WMS);
    expect(flagFor('/wms/bin-stock')).toBe(FEATURE_FLAGS.PLUGINS_WMS);
    expect(flagFor('/wms/lots')).toBe(FEATURE_FLAGS.PLUGINS_WMS);
    expect(flagFor('/3pl-operations/receiving')).toBe(FEATURE_FLAGS.PLUGINS_THREE_PL);
    expect(flagFor('/3pl-operations/shipments')).toBe(FEATURE_FLAGS.PLUGINS_THREE_PL);
    // Always-on spine surfaces carry no flag.
    expect(flagFor('/catalog/items')).toBeUndefined();
    expect(flagFor('/inventory/warehouses')).toBeUndefined();
  });

  it('PRODUCTION AND FULFILLMENT holds manufacturing, copack, and the 3PL commercial layer, each entitlement-gated', () => {
    const mode = SIDEBAR_MODES.find((m) => m.key === 'production')!;
    const paths = mode.routes.map((r) => r.path);
    expect(paths).toContain('/manufacturing/runs');
    expect(paths).toContain('/copack/orders');
    expect(paths).toContain('/copack/kitting');
    expect(paths).toContain('/copack/fulfillments');
    expect(paths).toContain('/copack/channels');
    expect(paths).toContain('/3pl-operations/accounts');
    expect(paths).toContain('/3pl-operations/job-builders');
    expect(paths).toContain('/3pl-operations/supply-plans');
    expect(paths).toContain('/3pl-operations/job-runs');
    expect(paths).toContain('/3pl-operations/billing-reviews');
    // Every production route is plugin-gated, so the section drops when no
    // production or fulfillment add-on is on.
    for (const route of mode.routes) {
      expect(route.requiresFlag, `gate on ${route.path}`).toBeDefined();
    }
  });

  it('MONEY holds invoicing and finance, with journal entries behind its feature flag', () => {
    const mode = SIDEBAR_MODES.find((m) => m.key === 'money')!;
    const paths = mode.routes.map((r) => r.path);
    expect(paths).toContain('/invoicing/invoices');
    expect(paths).toContain('/invoicing/payments');
    expect(paths).toContain('/invoicing/credit-notes');
    expect(paths).toContain('/finance/coa');
    expect(paths).toContain('/finance/period-close');
    expect(paths).toContain('/finance/journal-entries');
    const je = mode.routes.find((r) => r.path === '/finance/journal-entries');
    expect(je?.requiresFlag).toBe(FEATURE_FLAGS.FINANCE_JOURNAL_ENTRIES_ENABLED);
    // The rest of MONEY is always-on spine.
    for (const route of mode.routes) {
      if (route.path === '/finance/journal-entries') continue;
      expect(route.requiresFlag, `gate on ${route.path}`).toBeUndefined();
    }
  });

  it('WORKFORCE holds the five KitForce surfaces, each gated plugins.kitforce', () => {
    const mode = SIDEBAR_MODES.find((m) => m.key === 'workforce')!;
    const paths = mode.routes.map((r) => r.path);
    expect(paths).toEqual([
      '/kitforce/members',
      '/kitforce/teams',
      '/kitforce/shifts',
      '/kitforce/assignments',
      '/kitforce/time-entries',
    ]);
    for (const route of mode.routes) {
      expect(route.requiresFlag, `flag on ${route.path}`).toBe(
        FEATURE_FLAGS.PLUGINS_KITFORCE,
      );
    }
  });

  it('INSIGHTS holds the cost dashboard (kitcost) and profitability (3PL)', () => {
    const mode = SIDEBAR_MODES.find((m) => m.key === 'insights')!;
    const dash = mode.routes.find((r) => r.path === '/kitcost/dashboard');
    const profit = mode.routes.find((r) => r.path === '/3pl-operations/profitability');
    expect(dash?.requiresFlag).toBe(FEATURE_FLAGS.PLUGINS_KITCOST);
    expect(profit?.requiresFlag).toBe(FEATURE_FLAGS.PLUGINS_THREE_PL);
  });

  it('SETTINGS folds in the admin block (organization, configuration, data) plus sales config', () => {
    const paths = pathsFor('settings');
    expect(paths).toContain('/admin/settings');
    expect(paths).toContain('/admin/members');
    expect(paths).toContain('/admin/sso');
    expect(paths).toContain('/admin/billing');
    expect(paths).toContain('/settings/sales-config/taxes');
    expect(paths).toContain('/admin/branding');
    expect(paths).toContain('/admin/numbering');
    expect(paths).toContain('/admin/flags');
    expect(paths).toContain('/imports');
    expect(paths).toContain('/exports');
  });

  it('does NOT surface the legacy /3pl-operations/production entry (BNEW-2)', () => {
    const allPaths = SIDEBAR_MODES.flatMap((m) => m.routes.map((r) => r.path));
    expect(allPaths).not.toContain('/3pl-operations/production');
    expect(allPaths).not.toContain('/3pl-operations/production/new');
  });
});

describe('isModeVisible role scoping (task-based IA)', () => {
  it('SETTINGS is the only admin-only section', () => {
    const adminOnly = SIDEBAR_MODES.filter((m) => m.adminOnly === true).map(
      (m) => m.key,
    );
    expect(adminOnly).toEqual(['settings']);
  });

  it('SETTINGS shows only for org_owner and org_admin', () => {
    const settings = SIDEBAR_MODES.find((m) => m.key === 'settings')!;
    for (const role of ALL_ROLES) {
      const expected = role === 'org_owner' || role === 'org_admin';
      expect(isModeVisible(settings, role, canFor(role)), `settings for ${role}`).toBe(
        expected,
      );
    }
  });

  it('SELL and MONEY show for every internal role (they hold the read caps)', () => {
    const sell = SIDEBAR_MODES.find((m) => m.key === 'sell')!;
    const money = SIDEBAR_MODES.find((m) => m.key === 'money')!;
    for (const role of ['org_owner', 'org_admin', 'sales', 'ops', 'accounting', 'viewer'] as const) {
      expect(isModeVisible(sell, role, canFor(role)), `sell for ${role}`).toBe(true);
      expect(isModeVisible(money, role, canFor(role)), `money for ${role}`).toBe(true);
    }
  });

  it('WORKFORCE hides from sales and viewer, shows for owner/admin/ops/accounting', () => {
    const wf = SIDEBAR_MODES.find((m) => m.key === 'workforce')!;
    expect(isModeVisible(wf, 'sales', canFor('sales'))).toBe(false);
    expect(isModeVisible(wf, 'viewer', canFor('viewer'))).toBe(false);
    expect(isModeVisible(wf, 'org_owner', canFor('org_owner'))).toBe(true);
    expect(isModeVisible(wf, 'org_admin', canFor('org_admin'))).toBe(true);
    expect(isModeVisible(wf, 'ops', canFor('ops'))).toBe(true);
    expect(isModeVisible(wf, 'accounting', canFor('accounting'))).toBe(true);
  });

  it('PRODUCTION has no role gate (entitlement decides), so it is role-visible to all', () => {
    const prod = SIDEBAR_MODES.find((m) => m.key === 'production')!;
    expect(prod.requiresAnyCap).toBeUndefined();
    expect(prod.adminOnly).not.toBe(true);
    for (const role of ALL_ROLES) {
      expect(isModeVisible(prod, role, canFor(role)), `production for ${role}`).toBe(
        true,
      );
    }
  });

  it('a null role only sees sections with no role gate', () => {
    const sell = SIDEBAR_MODES.find((m) => m.key === 'sell')!;
    const production = SIDEBAR_MODES.find((m) => m.key === 'production')!;
    const settings = SIDEBAR_MODES.find((m) => m.key === 'settings')!;
    const denyAll = () => false;
    expect(isModeVisible(production, null, denyAll)).toBe(true);
    expect(isModeVisible(sell, null, denyAll)).toBe(false);
    expect(isModeVisible(settings, null, denyAll)).toBe(false);
  });

  it('INSIGHTS shows for every internal role and hides from portal roles', () => {
    const insights = SIDEBAR_MODES.find((m) => m.key === 'insights')!;
    const internal: ReadonlyArray<RoleCode> = [
      'org_owner',
      'org_admin',
      'sales',
      'ops',
      'accounting',
      'viewer',
    ];
    // Every internal role holds threepl.profitability.read (or kitcost view),
    // so INSIGHTS is role-visible to all of them; entitlement still gates routes.
    for (const role of internal) {
      expect(
        isModeVisible(insights, role, canFor(role)),
        `insights for ${role}`,
      ).toBe(true);
    }
    for (const role of ['customer_user', 'vendor_user'] as const) {
      expect(
        isModeVisible(insights, role, canFor(role)),
        `insights for ${role}`,
      ).toBe(false);
    }
  });

  it('portal roles only see role-ungated sections (customer_user keeps SELL via quotes read)', () => {
    const byKey = (k: ModeKey) => SIDEBAR_MODES.find((m) => m.key === k)!;
    // customer_user holds quotes.quote.read + projects.project.read.
    expect(
      isModeVisible(byKey('sell'), 'customer_user', canFor('customer_user')),
    ).toBe(true);
    expect(
      isModeVisible(byKey('production'), 'customer_user', canFor('customer_user')),
    ).toBe(true);
    for (const k of ['buy', 'inventory', 'money', 'workforce', 'insights', 'settings'] as const) {
      expect(
        isModeVisible(byKey(k), 'customer_user', canFor('customer_user')),
        `${k} for customer_user`,
      ).toBe(false);
    }
    // vendor_user holds only PO + vendor-bill read (no vendors.read, no quotes),
    // so it sees only the role-ungated PRODUCTION section.
    expect(
      isModeVisible(byKey('production'), 'vendor_user', canFor('vendor_user')),
    ).toBe(true);
    for (const k of ['sell', 'buy', 'inventory', 'money', 'workforce', 'insights', 'settings'] as const) {
      expect(
        isModeVisible(byKey(k), 'vendor_user', canFor('vendor_user')),
        `${k} for vendor_user`,
      ).toBe(false);
    }
  });
});

describe('defaultOpenModeForRole (role home section)', () => {
  it('maps each role to its home task section', () => {
    expect(defaultOpenModeForRole('sales')).toBe('sell');
    expect(defaultOpenModeForRole('ops')).toBe('inventory');
    expect(defaultOpenModeForRole('accounting')).toBe('money');
    expect(defaultOpenModeForRole('org_owner')).toBe('sell');
    expect(defaultOpenModeForRole('org_admin')).toBe('sell');
    expect(defaultOpenModeForRole('viewer')).toBe('sell');
    expect(defaultOpenModeForRole(null)).toBe('sell');
  });

  it('every home section key exists in SIDEBAR_MODES', () => {
    const keys = new Set(SIDEBAR_MODES.map((m) => m.key));
    for (const role of ALL_ROLES) {
      expect(keys.has(defaultOpenModeForRole(role)), `home for ${role}`).toBe(true);
    }
  });
});

describe('isRouteVisible (flag gating)', () => {
  it('returns true when route has no flag requirement', () => {
    expect(
      isRouteVisible({ path: '/crm/leads', label: 'Leads', icon: Target }, {}),
    ).toBe(true);
  });

  it('returns true when required flag is on', () => {
    expect(
      isRouteVisible(
        {
          path: '/manufacturing/runs',
          label: 'Manufacturing runs',
          icon: Factory,
          requiresFlag: FEATURE_FLAGS.PLUGINS_MANUFACTURING,
        },
        { [FEATURE_FLAGS.PLUGINS_MANUFACTURING]: true },
      ),
    ).toBe(true);
  });

  it('returns false when required flag is off or absent (absent === off)', () => {
    const route = {
      path: '/manufacturing/runs',
      label: 'Manufacturing runs',
      icon: Factory,
      requiresFlag: FEATURE_FLAGS.PLUGINS_MANUFACTURING,
    };
    expect(
      isRouteVisible(route, { [FEATURE_FLAGS.PLUGINS_MANUFACTURING]: false }),
    ).toBe(false);
    expect(isRouteVisible(route, {})).toBe(false);
  });
});

describe('visibleRoutesForMode (flag gating)', () => {
  it('drops the entitlement-gated PRODUCTION routes when no add-on is on', () => {
    const mode = SIDEBAR_MODES.find((m) => m.key === 'production')!;
    const visible = visibleRoutesForMode(mode, {});
    expect(visible).toHaveLength(0);
  });

  it('keeps the always-on INVENTORY backbone with no flags, minus gated add-on routes', () => {
    const inv = SIDEBAR_MODES.find((m) => m.key === 'inventory')!;
    const paths = visibleRoutesForMode(inv, {}).map((r) => r.path);
    // Spine catalog/stock/warehouse stay.
    expect(paths).toContain('/catalog/items');
    expect(paths).toContain('/inventory/stock/levels');
    expect(paths).toContain('/inventory/warehouses');
    // WMS and 3PL add-on routes drop.
    expect(paths).not.toContain('/wms/putaway');
    expect(paths).not.toContain('/3pl-operations/receiving');
  });

  it('shows journal entries on MONEY only when its feature flag is on', () => {
    const money = SIDEBAR_MODES.find((m) => m.key === 'money')!;
    expect(visibleRoutesForMode(money, {}).map((r) => r.path)).not.toContain(
      '/finance/journal-entries',
    );
    expect(
      visibleRoutesForMode(money, {
        [FEATURE_FLAGS.FINANCE_JOURNAL_ENTRIES_ENABLED]: true,
      }).map((r) => r.path),
    ).toContain('/finance/journal-entries');
  });

  it('hides every WORKFORCE route when plugins.kitforce is off', () => {
    const wf = SIDEBAR_MODES.find((m) => m.key === 'workforce')!;
    expect(
      visibleRoutesForMode(wf, { [FEATURE_FLAGS.PLUGINS_KITFORCE]: false }),
    ).toHaveLength(0);
  });
});

describe('visibleRoutesForMode (per-route capability gating)', () => {
  const ALL_FLAGS_ON: Record<string, boolean> = Object.values(FEATURE_FLAGS).reduce(
    (acc, flag) => {
      acc[flag] = true;
      return acc;
    },
    {} as Record<string, boolean>,
  );

  it('drops only the denied route from SELL while its siblings remain', () => {
    const sell = SIDEBAR_MODES.find((m) => m.key === 'sell')!;
    // Allow everything except crm.leads.read.
    const can = (cap: Capability) => cap !== 'crm.leads.read';
    const paths = visibleRoutesForMode(sell, {}, can).map((r) => r.path);
    expect(paths).not.toContain('/crm/leads');
    // Siblings (each gated on a different read cap) stay.
    expect(paths).toContain('/crm/customers');
    expect(paths).toContain('/crm/contacts');
    expect(paths).toContain('/crm/opportunities');
    expect(paths).toContain('/crm/activities');
    expect(paths).toContain('/quotes');
    expect(paths).toContain('/projects');
  });

  it('keeps a route with no requiresCap (PRODUCTION Putaway-style) even when can denies all', () => {
    // PUTAWAY carries a flag but no read cap; with its flag on and an all-denying
    // predicate it must still survive (it rides on the section gate alone).
    const inv = SIDEBAR_MODES.find((m) => m.key === 'inventory')!;
    const putaway = inv.routes.find((r) => r.path === '/wms/putaway')!;
    expect(putaway.requiresCap).toBeUndefined();
    const denyAll = () => false;
    const paths = visibleRoutesForMode(
      inv,
      { [FEATURE_FLAGS.PLUGINS_WMS]: true },
      denyAll,
    ).map((r) => r.path);
    expect(paths).toContain('/wms/putaway');
    // A capped sibling under the same flag is dropped by the all-denying predicate.
    expect(paths).not.toContain('/wms/locations');
  });

  it('every PRODUCTION route survives an all-denying predicate (all are requiresCap-undefined)', () => {
    const prod = SIDEBAR_MODES.find((m) => m.key === 'production')!;
    const denyAll = () => false;
    const visible = visibleRoutesForMode(prod, ALL_FLAGS_ON, denyAll);
    // Every PRODUCTION entry is action-cap-only (requiresCap undefined), so the
    // per-route gate never drops them; only the section gate governs PRODUCTION.
    expect(visible.map((r) => r.path)).toEqual(prod.routes.map((r) => r.path));
    for (const route of prod.routes) {
      expect(route.requiresCap, `requiresCap on ${route.path}`).toBeUndefined();
    }
  });

  it('matches the real canon: an ops role keeps invoicing reads but loses the ledger reads in MONEY', () => {
    // ops holds invoices.read / payments.read / credit_notes.read, but NOT
    // coa.read / period_close.read / journal_entries.read.
    const can = canFor('ops');
    const money = SIDEBAR_MODES.find((m) => m.key === 'money')!;
    // Turn the journal-entries flag on so its drop is the cap gate, not the flag.
    const paths = visibleRoutesForMode(
      money,
      { [FEATURE_FLAGS.FINANCE_JOURNAL_ENTRIES_ENABLED]: true },
      can,
    ).map((r) => r.path);
    expect(paths).toContain('/invoicing/invoices');
    expect(paths).toContain('/invoicing/payments');
    expect(paths).toContain('/invoicing/credit-notes');
    expect(paths).not.toContain('/finance/coa');
    expect(paths).not.toContain('/finance/period-close');
    expect(paths).not.toContain('/finance/journal-entries');
  });

  it('matches the real canon: a viewer holds every SELL read, so SELL stays intact', () => {
    // viewer holds every crm.*.read plus quotes/projects read.
    const can = canFor('viewer');
    const sell = SIDEBAR_MODES.find((m) => m.key === 'sell')!;
    const paths = visibleRoutesForMode(sell, {}, can).map((r) => r.path);
    expect(paths).toEqual(sell.routes.map((r) => r.path));
  });

  it('every requiresCap set is a capability held by org_owner (canon sanity check)', () => {
    for (const mode of SIDEBAR_MODES) {
      for (const route of mode.routes) {
        if (route.requiresCap === undefined) continue;
        expect(
          hasCap('org_owner', route.requiresCap),
          `org_owner should hold ${route.requiresCap} (gate on ${route.path})`,
        ).toBe(true);
      }
    }
  });
});

describe('isRouteCapVisible (per-route role-scope predicate)', () => {
  it('returns true when the route has no requiresCap', () => {
    const denyAll = () => false;
    expect(
      isRouteCapVisible({ path: '/wms/putaway', label: 'Putaway', icon: Factory }, denyAll),
    ).toBe(true);
  });

  it('returns true only when the predicate grants the required cap', () => {
    const route = {
      path: '/crm/leads',
      label: 'Leads',
      icon: Target,
      requiresCap: 'crm.leads.read' as Capability,
    };
    expect(isRouteCapVisible(route, (cap) => cap === 'crm.leads.read')).toBe(true);
    expect(isRouteCapVisible(route, () => false)).toBe(false);
  });
});

describe('findActiveMode (task-based IA)', () => {
  it('returns null when pathname matches no route', () => {
    expect(findActiveMode('/some/unknown/path')).toBe(null);
  });

  it('maps each path to its owning task section', () => {
    expect(findActiveMode('/crm/leads')).toBe('sell');
    expect(findActiveMode('/quotes')).toBe('sell');
    expect(findActiveMode('/purchasing/vendors')).toBe('buy');
    expect(findActiveMode('/catalog/items')).toBe('inventory');
    expect(findActiveMode('/catalog/boms')).toBe('inventory');
    expect(findActiveMode('/wms/locations')).toBe('inventory');
    // 3PL receiving/shipping live under INVENTORY, the rest under PRODUCTION.
    expect(findActiveMode('/3pl-operations/receiving')).toBe('inventory');
    expect(findActiveMode('/3pl-operations/shipments')).toBe('inventory');
    expect(findActiveMode('/3pl-operations/accounts')).toBe('production');
    expect(findActiveMode('/manufacturing/runs')).toBe('production');
    expect(findActiveMode('/copack/orders')).toBe('production');
    expect(findActiveMode('/finance/coa')).toBe('money');
    expect(findActiveMode('/invoicing/invoices')).toBe('money');
    expect(findActiveMode('/kitforce/members')).toBe('workforce');
    expect(findActiveMode('/kitcost/dashboard')).toBe('insights');
    expect(findActiveMode('/3pl-operations/profitability')).toBe('insights');
    expect(findActiveMode('/admin/settings')).toBe('settings');
    expect(findActiveMode('/settings/sales-config/taxes')).toBe('settings');
    expect(findActiveMode('/imports')).toBe('settings');
  });

  it('matches detail/subpath URLs via prefix-with-slash', () => {
    expect(findActiveMode('/quotes/xyz/send')).toBe('sell');
    expect(findActiveMode('/3pl-operations/accounts/abc-123')).toBe('production');
    expect(findActiveMode('/3pl-operations/shipments/abc-123')).toBe('inventory');
    expect(findActiveMode('/manufacturing/runs/abc-123')).toBe('production');
    expect(findActiveMode('/kitforce/members/new')).toBe('workforce');
  });

  it('does NOT confuse prefix-without-slash matches', () => {
    // /quotesomething should not match /quotes.
    expect(findActiveMode('/quotesextra')).toBe(null);
  });
});

describe('groupRoutesByDomain (sub-grouping for a11y)', () => {
  it('splits SELL into one labelled run per domain, in order', () => {
    const sell = SIDEBAR_MODES.find((m) => m.key === 'sell')!;
    const groups = groupRoutesByDomain(sell.routes);
    expect(groups.map((g) => g.label)).toEqual(['CRM', 'Quotes', 'Projects']);
  });

  it('partitions a section with none dropped or reordered', () => {
    const inv = SIDEBAR_MODES.find((m) => m.key === 'inventory')!;
    const groups = groupRoutesByDomain(inv.routes);
    const flattened = groups.flatMap((g) => g.routes.map((r) => r.path));
    expect(flattened).toEqual(inv.routes.map((r) => r.path));
  });

  it('collects an ungrouped single-domain section into one label-undefined run', () => {
    const buy = SIDEBAR_MODES.find((m) => m.key === 'buy')!;
    const groups = groupRoutesByDomain(buy.routes);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBeUndefined();
    expect(groups[0]?.routes.length).toBe(buy.routes.length);
  });

  it('returns an empty array for no routes', () => {
    expect(groupRoutesByDomain([])).toEqual([]);
  });
});

describe('filterRoutesByQuery (sidebar type-to-filter)', () => {
  const sell = SIDEBAR_MODES.find((m) => m.key === 'sell')!;

  it('returns the same list reference for a blank or whitespace-only query', () => {
    expect(filterRoutesByQuery(sell.routes, '')).toBe(sell.routes);
    expect(filterRoutesByQuery(sell.routes, '   ')).toBe(sell.routes);
  });

  it('matches route labels case-insensitively', () => {
    const money = SIDEBAR_MODES.find((m) => m.key === 'money')!;
    const result = filterRoutesByQuery(money.routes, 'INVOICE');
    expect(result.map((r) => r.path)).toContain('/invoicing/invoices');
    expect(result.every((r) => r.label.toLowerCase().includes('invoice'))).toBe(
      true,
    );
  });

  it('matches on a substring of the label', () => {
    const result = filterRoutesByQuery(sell.routes, 'cust');
    expect(result.map((r) => r.label)).toEqual(['Customers']);
  });

  it('returns an empty list when nothing matches', () => {
    expect(filterRoutesByQuery(sell.routes, 'zzznotathing')).toEqual([]);
  });
});
