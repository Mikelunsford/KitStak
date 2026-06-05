// UX-Q1: pin the job-mode sidebar IA.
//
// Tests the pure SIDEBAR_MODES export plus its helpers
// (isRouteVisible, visibleRoutesForMode, findActiveMode) without a
// React renderer (mirrors the precedent in sidebarGating.test.ts and
// featureFlagResolver.test.ts).

import { describe, it, expect } from 'vitest';
import { Factory, Target } from 'lucide-react';

import {
  SIDEBAR_MODES,
  isRouteVisible,
  visibleRoutesForMode,
  findActiveMode,
  type ModeKey,
} from './sidebarModes';
import { FEATURE_FLAGS } from '@/lib/constants';

describe('SIDEBAR_MODES shape (UX-Q1)', () => {
  it('contains exactly six modes', () => {
    expect(SIDEBAR_MODES).toHaveLength(6);
  });

  it('modes are SELL / MAKE / SHIP / GET PAID / LIBRARY / WORKFORCE in workflow order', () => {
    const keys = SIDEBAR_MODES.map((m) => m.key);
    expect(keys).toEqual<ModeKey[]>([
      'sell',
      'make',
      'ship',
      'get_paid',
      'library',
      'workforce',
    ]);
  });

  it('every mode has at least one route', () => {
    for (const mode of SIDEBAR_MODES) {
      expect(mode.routes.length, `mode ${mode.key}`).toBeGreaterThan(0);
    }
  });

  it('every mode has a branded uppercase label and a period-ending subtitle', () => {
    for (const mode of SIDEBAR_MODES) {
      // No em dashes, no double-hyphens, no emojis (branding rules).
      expect(mode.label, `${mode.key} label`).toBe(mode.label.toUpperCase());
      expect(mode.subtitle, `${mode.key} subtitle`).toMatch(/\.$/);
      expect(mode.subtitle, `${mode.key} no em dash`).not.toMatch(/—/);
      expect(mode.subtitle, `${mode.key} no double hyphen`).not.toMatch(/--/);
    }
  });

  it('no duplicate routes across modes (every path lives in exactly one mode)', () => {
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

describe('SIDEBAR_MODES routing decisions (UX-Q1)', () => {
  function pathsFor(key: ModeKey): string[] {
    const mode = SIDEBAR_MODES.find((m) => m.key === key);
    if (!mode) throw new Error(`mode not found: ${key}`);
    return mode.routes.map((r) => r.path);
  }

  it('SELL groups CRM funnel routes plus quotes', () => {
    const paths = pathsFor('sell');
    expect(paths).toContain('/crm/leads');
    expect(paths).toContain('/crm/opportunities');
    expect(paths).toContain('/crm/activities');
    expect(paths).toContain('/3pl-operations/quotes');
  });

  it('MAKE groups projects + manufacturing + receiving (legacy production route excluded post-BNEW-2)', () => {
    const paths = pathsFor('make');
    expect(paths).toContain('/3pl-operations/projects');
    expect(paths).toContain('/manufacturing/runs');
    expect(paths).toContain('/3pl-operations/receiving');
  });

  it('MAKE does NOT contain the legacy /3pl-operations/production sidebar entry (BNEW-2, 2026-05-22 v2 smoke)', () => {
    // The legacy production-runs surface rendered an older form (raw UUID
    // inputs, no warehouse dropdown, no auto-number, no item picker). The
    // canonical surface is /manufacturing/runs. The legacy routes stay
    // registered as <Navigate> redirects in routes.ts so deep links land
    // on the new surface; they MUST NOT appear in the sidebar.
    // Follow-up: F-Wave9-LEGACY-PRODUCTION-ROUTE-RETIRE-01.
    const paths = pathsFor('make');
    expect(paths).not.toContain('/3pl-operations/production');
    expect(paths).not.toContain('/3pl-operations/production/new');
  });

  it('SHIP groups shipments and stock movements only', () => {
    const paths = pathsFor('ship');
    expect(paths).toContain('/3pl-operations/shipments');
    expect(paths).toContain('/inventory/stock/movements');
  });

  it('GET PAID groups invoices, credit notes, payments, journal entries', () => {
    const paths = pathsFor('get_paid');
    expect(paths).toContain('/invoicing/invoices');
    expect(paths).toContain('/invoicing/credit-notes');
    expect(paths).toContain('/invoicing/payments');
    expect(paths).toContain('/finance/journal-entries');
  });

  it('LIBRARY holds customers + reference data + procurement (AP-in-Library compromise)', () => {
    const paths = pathsFor('library');
    // Customers + Contacts are reference data, not transactional.
    expect(paths).toContain('/crm/customers');
    expect(paths).toContain('/crm/contacts');
    // Reference data.
    expect(paths).toContain('/catalog/items');
    expect(paths).toContain('/inventory/warehouses');
    // AP (no separate BUY mode — documented compromise).
    expect(paths).toContain('/purchasing/vendors');
    expect(paths).toContain('/purchasing/purchase-orders');
    expect(paths).toContain('/purchasing/vendor-bills');
    expect(paths).toContain('/purchasing/expenses');
  });

  it('Manufacturing route is gated behind plugins.manufacturing', () => {
    const make = SIDEBAR_MODES.find((m) => m.key === 'make');
    expect(make).toBeDefined();
    const mfg = make!.routes.find((r) => r.path === '/manufacturing/runs');
    expect(mfg?.requiresFlag).toBe(FEATURE_FLAGS.PLUGINS_MANUFACTURING);
  });

  it('Co-Pack surfaces sit in their workflow modes and are gated behind plugins.copack_ecom', () => {
    const expectations: ReadonlyArray<[ModeKey, string]> = [
      ['sell', '/copack/orders'],
      ['make', '/copack/kitting'],
      ['ship', '/copack/fulfillments'],
      ['library', '/copack/channels'],
    ];
    for (const [key, path] of expectations) {
      const mode = SIDEBAR_MODES.find((m) => m.key === key);
      expect(mode, `mode ${key}`).toBeDefined();
      const route = mode!.routes.find((r) => r.path === path);
      expect(route, `route ${path} in ${key}`).toBeDefined();
      expect(route?.requiresFlag, `flag on ${path}`).toBe(
        FEATURE_FLAGS.PLUGINS_COPACK_ECOM,
      );
    }
  });

  it('Journal entries route is gated behind finance.journal_entries.enabled', () => {
    const gp = SIDEBAR_MODES.find((m) => m.key === 'get_paid');
    expect(gp).toBeDefined();
    const je = gp!.routes.find((r) => r.path === '/finance/journal-entries');
    expect(je?.requiresFlag).toBe(
      FEATURE_FLAGS.FINANCE_JOURNAL_ENTRIES_ENABLED,
    );
  });

  it('WORKFORCE groups the KitForce people-and-labor surfaces (S1, 2026-05-31)', () => {
    const paths = pathsFor('workforce');
    expect(paths).toContain('/kitforce/members');
    expect(paths).toContain('/kitforce/teams');
    expect(paths).toContain('/kitforce/shifts');
    expect(paths).toContain('/kitforce/assignments');
    expect(paths).toContain('/kitforce/time-entries');
  });

  it('every WORKFORCE route is gated behind plugins.kitforce (S1 SPA-render gate)', () => {
    const wf = SIDEBAR_MODES.find((m) => m.key === 'workforce');
    expect(wf).toBeDefined();
    for (const route of wf!.routes) {
      expect(route.requiresFlag, `flag on ${route.path}`).toBe(
        FEATURE_FLAGS.PLUGINS_KITFORCE,
      );
    }
  });
});

describe('isRouteVisible (UX-Q1)', () => {
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

  it('returns false when required flag is off', () => {
    expect(
      isRouteVisible(
        {
          path: '/manufacturing/runs',
          label: 'Manufacturing runs',
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
          label: 'Manufacturing runs',
          icon: Factory,
          requiresFlag: FEATURE_FLAGS.PLUGINS_MANUFACTURING,
        },
        {},
      ),
    ).toBe(false);
  });
});

describe('visibleRoutesForMode (UX-Q1)', () => {
  it('filters out manufacturing route when plugins.manufacturing is off', () => {
    const make = SIDEBAR_MODES.find((m) => m.key === 'make')!;
    const visible = visibleRoutesForMode(make, {
      [FEATURE_FLAGS.PLUGINS_MANUFACTURING]: false,
    });
    const paths = visible.map((r) => r.path);
    expect(paths).not.toContain('/manufacturing/runs');
    // Other routes still present.
    expect(paths).toContain('/3pl-operations/projects');
    expect(paths).toContain('/3pl-operations/receiving');
  });

  it('includes manufacturing route when plugins.manufacturing is on', () => {
    const make = SIDEBAR_MODES.find((m) => m.key === 'make')!;
    const visible = visibleRoutesForMode(make, {
      [FEATURE_FLAGS.PLUGINS_MANUFACTURING]: true,
    });
    expect(visible.map((r) => r.path)).toContain('/manufacturing/runs');
  });

  it('filters out journal entries when its flag is off', () => {
    const gp = SIDEBAR_MODES.find((m) => m.key === 'get_paid')!;
    const visible = visibleRoutesForMode(gp, {
      [FEATURE_FLAGS.FINANCE_JOURNAL_ENTRIES_ENABLED]: false,
    });
    expect(visible.map((r) => r.path)).not.toContain('/finance/journal-entries');
  });

  it('keeps every route when all gating flags for the mode are satisfied', () => {
    const ship = SIDEBAR_MODES.find((m) => m.key === 'ship')!;
    const allFlagsOn = {
      [FEATURE_FLAGS.PLUGINS_COPACK_ECOM]: true,
    };
    expect(visibleRoutesForMode(ship, allFlagsOn).length).toBe(
      ship.routes.length,
    );
  });

  it('filters out the copack fulfillments route when plugins.copack_ecom is off', () => {
    const ship = SIDEBAR_MODES.find((m) => m.key === 'ship')!;
    const visible = visibleRoutesForMode(ship, {
      [FEATURE_FLAGS.PLUGINS_COPACK_ECOM]: false,
    });
    const paths = visible.map((r) => r.path);
    expect(paths).not.toContain('/copack/fulfillments');
    // Unflagged routes stay.
    expect(paths).toContain('/3pl-operations/shipments');
  });

  it('hides every WORKFORCE route when plugins.kitforce is off', () => {
    const wf = SIDEBAR_MODES.find((m) => m.key === 'workforce')!;
    const visible = visibleRoutesForMode(wf, {
      [FEATURE_FLAGS.PLUGINS_KITFORCE]: false,
    });
    expect(visible).toHaveLength(0);
  });

  it('shows every WORKFORCE route when plugins.kitforce is on', () => {
    const wf = SIDEBAR_MODES.find((m) => m.key === 'workforce')!;
    const visible = visibleRoutesForMode(wf, {
      [FEATURE_FLAGS.PLUGINS_KITFORCE]: true,
    });
    expect(visible.length).toBe(wf.routes.length);
  });
});

describe('findActiveMode (UX-Q1)', () => {
  it('returns null when pathname matches no route', () => {
    expect(findActiveMode('/some/unknown/path')).toBe(null);
  });

  it('matches exact path to its owning mode', () => {
    expect(findActiveMode('/crm/leads')).toBe('sell');
    expect(findActiveMode('/3pl-operations/quotes')).toBe('sell');
    expect(findActiveMode('/manufacturing/runs')).toBe('make');
    expect(findActiveMode('/3pl-operations/shipments')).toBe('ship');
    expect(findActiveMode('/invoicing/invoices')).toBe('get_paid');
    expect(findActiveMode('/crm/customers')).toBe('library');
    expect(findActiveMode('/kitforce/members')).toBe('workforce');
    expect(findActiveMode('/kitforce/time-entries')).toBe('workforce');
  });

  it('matches detail/subpath URLs via prefix-with-slash', () => {
    expect(findActiveMode('/manufacturing/runs/abc-123')).toBe('make');
    expect(findActiveMode('/3pl-operations/quotes/xyz/send')).toBe('sell');
    expect(findActiveMode('/invoicing/invoices/i_1/send')).toBe('get_paid');
    expect(findActiveMode('/catalog/items/new')).toBe('library');
    expect(findActiveMode('/kitforce/members/new')).toBe('workforce');
    expect(findActiveMode('/kitforce/assignments/a_1')).toBe('workforce');
  });

  it('does NOT confuse prefix-without-slash matches', () => {
    // /3pl-operations/quotesomething should not match /3pl-operations/quotes.
    // (No real route exists at this path, but the prefix-with-slash rule
    // is what makes the test meaningful.)
    expect(findActiveMode('/3pl-operations/quotesextra')).toBe(null);
  });
});

describe('mode label copy follows branding rules (UX-Q1)', () => {
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

  it('mode labels are GET PAID with a space (not GET-PAID or GETPAID)', () => {
    const gp = SIDEBAR_MODES.find((m) => m.key === 'get_paid');
    expect(gp?.label).toBe('GET PAID');
  });
});
