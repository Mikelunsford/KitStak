// Wave 12: pin the pillar-grouped sidebar IA (plan section 5.5, decision D4).
//
// Tests the pure SIDEBAR_MODES export plus its helpers (isRouteVisible,
// visibleRoutesForMode, findActiveMode) without a React renderer (mirrors the
// precedent in sidebarGating.test.ts and featureFlagResolver.test.ts).
//
// This supersedes the UX-Q1 six-job-mode assertions; the sidebar now has one
// always-on SPINE section (sub-grouped by domain) plus one section per lit
// add-on (3PL Operations, Manufacturing, Co-Pack and Ecom, KitForce, KitCost).

import { describe, it, expect } from 'vitest';
import { Factory, Target } from 'lucide-react';

import {
  SIDEBAR_MODES,
  isRouteVisible,
  visibleRoutesForMode,
  findActiveMode,
  groupRoutesByDomain,
  type ModeKey,
} from './sidebarModes';
import { FEATURE_FLAGS } from '@/lib/constants';

describe('SIDEBAR_MODES shape (Wave 12 pillar IA)', () => {
  it('contains exactly seven sections', () => {
    expect(SIDEBAR_MODES).toHaveLength(7);
  });

  it('sections are SPINE then one per lit add-on, in order', () => {
    const keys = SIDEBAR_MODES.map((m) => m.key);
    expect(keys).toEqual<ModeKey[]>([
      'spine',
      'three_pl',
      'manufacturing',
      'copack',
      'kitforce',
      'kitcost',
      'wms',
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

  it('contains the WMS section (add-on six, Wave 12 Body B Phase B0)', () => {
    const keys = SIDEBAR_MODES.map((m) => m.key as string);
    expect(keys).toContain('wms');
  });
});

describe('SIDEBAR_MODES section contents (Wave 12 pillar IA)', () => {
  function pathsFor(key: ModeKey): string[] {
    const mode = SIDEBAR_MODES.find((m) => m.key === key);
    if (!mode) throw new Error(`section not found: ${key}`);
    return mode.routes.map((r) => r.path);
  }

  it('SPINE holds the always-on backbone surfaces across every domain', () => {
    const paths = pathsFor('spine');
    // CRM
    expect(paths).toContain('/crm/customers');
    expect(paths).toContain('/crm/contacts');
    expect(paths).toContain('/crm/leads');
    expect(paths).toContain('/crm/opportunities');
    expect(paths).toContain('/crm/activities');
    // Quotes + Projects
    expect(paths).toContain('/quotes');
    expect(paths).toContain('/projects');
    // Catalog (Items, BOMs, VAS)
    expect(paths).toContain('/catalog/items');
    expect(paths).toContain('/catalog/boms');
    expect(paths).toContain('/catalog/vas');
    // Inventory
    expect(paths).toContain('/inventory/warehouses');
    expect(paths).toContain('/inventory/stock/levels');
    expect(paths).toContain('/inventory/stock/movements');
    // Purchasing
    expect(paths).toContain('/purchasing/vendors');
    expect(paths).toContain('/purchasing/purchase-orders');
    expect(paths).toContain('/purchasing/vendor-bills');
    expect(paths).toContain('/purchasing/expenses');
    // Invoicing
    expect(paths).toContain('/invoicing/invoices');
    expect(paths).toContain('/invoicing/credit-notes');
    expect(paths).toContain('/invoicing/payments');
    // Finance
    expect(paths).toContain('/finance/coa');
    expect(paths).toContain('/finance/period-close');
    expect(paths).toContain('/finance/journal-entries');
    // Settings
    expect(paths).toContain('/settings/sales-config/taxes');
  });

  it('every SPINE route carries a domain sub-group label', () => {
    const spine = SIDEBAR_MODES.find((m) => m.key === 'spine')!;
    for (const route of spine.routes) {
      expect(route.group, `group on ${route.path}`).toBeTruthy();
    }
  });

  it('SPINE sub-groups cover the nine plan domains, in order', () => {
    const spine = SIDEBAR_MODES.find((m) => m.key === 'spine')!;
    const seen: string[] = [];
    for (const route of spine.routes) {
      if (route.group && seen[seen.length - 1] !== route.group) {
        seen.push(route.group);
      }
    }
    expect(seen).toEqual([
      'CRM',
      'Quotes',
      'Projects',
      'Catalog',
      'Inventory',
      'Purchasing',
      'Invoicing',
      'Finance',
      'Settings',
    ]);
  });

  it('SPINE is always-on: no plugin flag gates a backbone route (only the journal-entries feature flag)', () => {
    const spine = SIDEBAR_MODES.find((m) => m.key === 'spine')!;
    for (const route of spine.routes) {
      if (route.requiresFlag === undefined) continue;
      // The one allowed gate on the spine is the journal-entries feature flag,
      // never a pillar plugin flag.
      expect(route.requiresFlag, `gate on ${route.path}`).toBe(
        FEATURE_FLAGS.FINANCE_JOURNAL_ENTRIES_ENABLED,
      );
    }
  });

  it('3PL OPERATIONS holds Accounts, Job Builders, Supply Plans, Job Runs, Billing Review, Profitability, Receiving, Shipments, each gated plugins.three_pl', () => {
    const mode = SIDEBAR_MODES.find((m) => m.key === 'three_pl')!;
    const paths = mode.routes.map((r) => r.path);
    expect(paths).toEqual([
      '/3pl-operations/accounts',
      '/3pl-operations/job-builders',
      '/3pl-operations/supply-plans',
      '/3pl-operations/job-runs',
      '/3pl-operations/billing-reviews',
      '/3pl-operations/profitability',
      '/3pl-operations/receiving',
      '/3pl-operations/shipments',
    ]);
    for (const route of mode.routes) {
      expect(route.requiresFlag, `flag on ${route.path}`).toBe(
        FEATURE_FLAGS.PLUGINS_THREE_PL,
      );
    }
  });

  it('Accounts (Wave 12 Phase A1) is the first 3PL Operations entry', () => {
    const mode = SIDEBAR_MODES.find((m) => m.key === 'three_pl')!;
    expect(mode.routes[0]?.path).toBe('/3pl-operations/accounts');
    expect(mode.routes[0]?.label).toBe('Accounts');
  });

  it('Job Builders (Wave 12 Phase A2) is the second 3PL Operations entry, gated plugins.three_pl', () => {
    const mode = SIDEBAR_MODES.find((m) => m.key === 'three_pl')!;
    expect(mode.routes[1]?.path).toBe('/3pl-operations/job-builders');
    expect(mode.routes[1]?.label).toBe('Job Builders');
    expect(mode.routes[1]?.requiresFlag).toBe(FEATURE_FLAGS.PLUGINS_THREE_PL);
  });

  it('Supply Plans (Wave 12 Phase A5) is the third 3PL Operations entry, gated plugins.three_pl', () => {
    const mode = SIDEBAR_MODES.find((m) => m.key === 'three_pl')!;
    expect(mode.routes[2]?.path).toBe('/3pl-operations/supply-plans');
    expect(mode.routes[2]?.label).toBe('Supply Plans');
    expect(mode.routes[2]?.requiresFlag).toBe(FEATURE_FLAGS.PLUGINS_THREE_PL);
  });

  it('Job Runs (Wave 12 Phase A6) is the fourth 3PL Operations entry, gated plugins.three_pl', () => {
    const mode = SIDEBAR_MODES.find((m) => m.key === 'three_pl')!;
    expect(mode.routes[3]?.path).toBe('/3pl-operations/job-runs');
    expect(mode.routes[3]?.label).toBe('Job Runs');
    expect(mode.routes[3]?.requiresFlag).toBe(FEATURE_FLAGS.PLUGINS_THREE_PL);
  });

  it('Billing Review (Wave 12 Phase A7) is the fifth 3PL Operations entry, after Job Runs, gated plugins.three_pl', () => {
    const mode = SIDEBAR_MODES.find((m) => m.key === 'three_pl')!;
    expect(mode.routes[4]?.path).toBe('/3pl-operations/billing-reviews');
    expect(mode.routes[4]?.label).toBe('Billing Review');
    expect(mode.routes[4]?.requiresFlag).toBe(FEATURE_FLAGS.PLUGINS_THREE_PL);
  });

  it('Profitability (Wave 12 Phase A7) is the sixth 3PL Operations entry, after Billing Review, gated plugins.three_pl', () => {
    const mode = SIDEBAR_MODES.find((m) => m.key === 'three_pl')!;
    expect(mode.routes[5]?.path).toBe('/3pl-operations/profitability');
    expect(mode.routes[5]?.label).toBe('Profitability');
    expect(mode.routes[5]?.requiresFlag).toBe(FEATURE_FLAGS.PLUGINS_THREE_PL);
  });

  it('MANUFACTURING holds Runs, gated plugins.manufacturing', () => {
    const mode = SIDEBAR_MODES.find((m) => m.key === 'manufacturing')!;
    const run = mode.routes.find((r) => r.path === '/manufacturing/runs');
    expect(run).toBeDefined();
    expect(run?.requiresFlag).toBe(FEATURE_FLAGS.PLUGINS_MANUFACTURING);
  });

  it('CO-PACK AND ECOM holds its four surfaces, each gated plugins.copack_ecom', () => {
    const mode = SIDEBAR_MODES.find((m) => m.key === 'copack')!;
    const paths = mode.routes.map((r) => r.path);
    expect(paths).toContain('/copack/orders');
    expect(paths).toContain('/copack/kitting');
    expect(paths).toContain('/copack/fulfillments');
    expect(paths).toContain('/copack/channels');
    for (const route of mode.routes) {
      expect(route.requiresFlag, `flag on ${route.path}`).toBe(
        FEATURE_FLAGS.PLUGINS_COPACK_ECOM,
      );
    }
  });

  it('KITFORCE holds the five people-and-labor surfaces, each gated plugins.kitforce', () => {
    const mode = SIDEBAR_MODES.find((m) => m.key === 'kitforce')!;
    const paths = mode.routes.map((r) => r.path);
    expect(paths).toContain('/kitforce/members');
    expect(paths).toContain('/kitforce/teams');
    expect(paths).toContain('/kitforce/shifts');
    expect(paths).toContain('/kitforce/assignments');
    expect(paths).toContain('/kitforce/time-entries');
    for (const route of mode.routes) {
      expect(route.requiresFlag, `flag on ${route.path}`).toBe(
        FEATURE_FLAGS.PLUGINS_KITFORCE,
      );
    }
  });

  it('KITCOST holds the cost dashboard, gated plugins.kitcost', () => {
    const mode = SIDEBAR_MODES.find((m) => m.key === 'kitcost')!;
    const dash = mode.routes.find((r) => r.path === '/kitcost/dashboard');
    expect(dash).toBeDefined();
    expect(dash?.requiresFlag).toBe(FEATURE_FLAGS.PLUGINS_KITCOST);
  });

  it('WMS holds Locations, Putaway, Bin stock, Lots, each gated plugins.wms', () => {
    const mode = SIDEBAR_MODES.find((m) => m.key === 'wms')!;
    const paths = mode.routes.map((r) => r.path);
    expect(paths).toEqual([
      '/wms/locations',
      '/wms/putaway',
      '/wms/bin-stock',
      '/wms/lots',
    ]);
    for (const route of mode.routes) {
      expect(route.requiresFlag, `flag on ${route.path}`).toBe(
        FEATURE_FLAGS.PLUGINS_WMS,
      );
    }
  });

  it('WMS section is labelled WMS with a period-ending subtitle', () => {
    const mode = SIDEBAR_MODES.find((m) => m.key === 'wms')!;
    expect(mode.label).toBe('WMS');
    expect(mode.subtitle).toMatch(/\.$/);
  });

  it('Journal entries route is gated behind finance.journal_entries.enabled', () => {
    const spine = SIDEBAR_MODES.find((m) => m.key === 'spine')!;
    const je = spine.routes.find((r) => r.path === '/finance/journal-entries');
    expect(je?.requiresFlag).toBe(FEATURE_FLAGS.FINANCE_JOURNAL_ENTRIES_ENABLED);
  });

  it('does NOT surface the legacy /3pl-operations/production entry (BNEW-2)', () => {
    const allPaths = SIDEBAR_MODES.flatMap((m) => m.routes.map((r) => r.path));
    expect(allPaths).not.toContain('/3pl-operations/production');
    expect(allPaths).not.toContain('/3pl-operations/production/new');
  });
});

describe('isRouteVisible (Wave 12 pillar IA)', () => {
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
          label: 'Runs',
          icon: Factory,
          requiresFlag: FEATURE_FLAGS.PLUGINS_MANUFACTURING,
        },
        { [FEATURE_FLAGS.PLUGINS_MANUFACTURING]: true },
      ),
    ).toBe(true);
  });

  it('returns false when required flag is off', () => {
    expect(
      isRouteVisible(
        {
          path: '/manufacturing/runs',
          label: 'Runs',
          icon: Factory,
          requiresFlag: FEATURE_FLAGS.PLUGINS_MANUFACTURING,
        },
        { [FEATURE_FLAGS.PLUGINS_MANUFACTURING]: false },
      ),
    ).toBe(false);
  });

  it('returns false when required flag is absent (absent === off)', () => {
    expect(
      isRouteVisible(
        {
          path: '/manufacturing/runs',
          label: 'Runs',
          icon: Factory,
          requiresFlag: FEATURE_FLAGS.PLUGINS_MANUFACTURING,
        },
        {},
      ),
    ).toBe(false);
  });
});

describe('visibleRoutesForMode (Wave 12 pillar IA)', () => {
  it('hides every 3PL Operations route when plugins.three_pl is off', () => {
    const mode = SIDEBAR_MODES.find((m) => m.key === 'three_pl')!;
    const visible = visibleRoutesForMode(mode, {
      [FEATURE_FLAGS.PLUGINS_THREE_PL]: false,
    });
    expect(visible).toHaveLength(0);
  });

  it('shows every 3PL Operations route when plugins.three_pl is on', () => {
    const mode = SIDEBAR_MODES.find((m) => m.key === 'three_pl')!;
    const visible = visibleRoutesForMode(mode, {
      [FEATURE_FLAGS.PLUGINS_THREE_PL]: true,
    });
    expect(visible.length).toBe(mode.routes.length);
    expect(visible.map((r) => r.path)).toContain('/3pl-operations/accounts');
  });

  it('keeps the SPINE backbone visible even with no flags set, minus the gated journal entries', () => {
    const spine = SIDEBAR_MODES.find((m) => m.key === 'spine')!;
    const visible = visibleRoutesForMode(spine, {});
    const paths = visible.map((r) => r.path);
    // Ungated backbone stays.
    expect(paths).toContain('/crm/customers');
    expect(paths).toContain('/catalog/items');
    expect(paths).toContain('/finance/coa');
    // The one flag-gated spine route drops when its flag is absent.
    expect(paths).not.toContain('/finance/journal-entries');
  });

  it('shows journal entries on the spine when its flag is on', () => {
    const spine = SIDEBAR_MODES.find((m) => m.key === 'spine')!;
    const visible = visibleRoutesForMode(spine, {
      [FEATURE_FLAGS.FINANCE_JOURNAL_ENTRIES_ENABLED]: true,
    });
    expect(visible.map((r) => r.path)).toContain('/finance/journal-entries');
  });

  it('hides every KITFORCE route when plugins.kitforce is off', () => {
    const wf = SIDEBAR_MODES.find((m) => m.key === 'kitforce')!;
    const visible = visibleRoutesForMode(wf, {
      [FEATURE_FLAGS.PLUGINS_KITFORCE]: false,
    });
    expect(visible).toHaveLength(0);
  });
});

describe('findActiveMode (Wave 12 pillar IA)', () => {
  it('returns null when pathname matches no route', () => {
    expect(findActiveMode('/some/unknown/path')).toBe(null);
  });

  it('matches exact path to its owning section', () => {
    expect(findActiveMode('/crm/leads')).toBe('spine');
    expect(findActiveMode('/quotes')).toBe('spine');
    expect(findActiveMode('/finance/coa')).toBe('spine');
    expect(findActiveMode('/3pl-operations/accounts')).toBe('three_pl');
    expect(findActiveMode('/3pl-operations/shipments')).toBe('three_pl');
    expect(findActiveMode('/manufacturing/runs')).toBe('manufacturing');
    expect(findActiveMode('/copack/orders')).toBe('copack');
    expect(findActiveMode('/kitforce/members')).toBe('kitforce');
    expect(findActiveMode('/kitcost/dashboard')).toBe('kitcost');
    expect(findActiveMode('/wms/locations')).toBe('wms');
  });

  it('matches detail/subpath URLs via prefix-with-slash', () => {
    expect(findActiveMode('/quotes/xyz/send')).toBe('spine');
    expect(findActiveMode('/3pl-operations/accounts/abc-123')).toBe('three_pl');
    expect(findActiveMode('/3pl-operations/accounts/new')).toBe('three_pl');
    expect(findActiveMode('/manufacturing/runs/abc-123')).toBe('manufacturing');
    expect(findActiveMode('/kitforce/members/new')).toBe('kitforce');
  });

  it('does NOT confuse prefix-without-slash matches', () => {
    // /quotesomething should not match /quotes.
    expect(findActiveMode('/quotesextra')).toBe(null);
  });
});

describe('section label copy follows branding rules (Wave 12 pillar IA)', () => {
  it('no em dashes in any label or subtitle', () => {
    for (const mode of SIDEBAR_MODES) {
      expect(mode.label).not.toMatch(/—/);
      expect(mode.subtitle).not.toMatch(/—/);
    }
  });

  it('no double hyphens in any label or subtitle', () => {
    for (const mode of SIDEBAR_MODES) {
      expect(mode.label).not.toMatch(/--/);
      expect(mode.subtitle).not.toMatch(/--/);
    }
  });

  it('the co-pack section label is CO-PACK AND ECOM', () => {
    const cp = SIDEBAR_MODES.find((m) => m.key === 'copack');
    expect(cp?.label).toBe('CO-PACK AND ECOM');
  });
});

describe('groupRoutesByDomain (SPINE sub-grouping for a11y)', () => {
  it('splits the SPINE section into one labelled run per domain, in order', () => {
    const spine = SIDEBAR_MODES.find((m) => m.key === 'spine')!;
    const groups = groupRoutesByDomain(spine.routes);
    expect(groups.map((g) => g.label)).toEqual([
      'CRM',
      'Quotes',
      'Projects',
      'Catalog',
      'Inventory',
      'Purchasing',
      'Invoicing',
      'Finance',
      'Settings',
    ]);
  });

  it('partitions every SPINE route with none dropped or reordered', () => {
    const spine = SIDEBAR_MODES.find((m) => m.key === 'spine')!;
    const groups = groupRoutesByDomain(spine.routes);
    const flattened = groups.flatMap((g) => g.routes.map((r) => r.path));
    expect(flattened).toEqual(spine.routes.map((r) => r.path));
  });

  it('collects ungrouped add-on routes into a single label-undefined run', () => {
    const threePl = SIDEBAR_MODES.find((m) => m.key === 'three_pl')!;
    const groups = groupRoutesByDomain(threePl.routes);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBeUndefined();
    expect(groups[0]?.routes.length).toBe(threePl.routes.length);
  });

  it('returns an empty array for no routes', () => {
    expect(groupRoutesByDomain([])).toEqual([]);
  });
});
