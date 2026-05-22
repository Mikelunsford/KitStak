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
  it('contains exactly five modes', () => {
    expect(SIDEBAR_MODES).toHaveLength(5);
  });

  it('modes are SELL / MAKE / SHIP / GET PAID / LIBRARY in workflow order', () => {
    const keys = SIDEBAR_MODES.map((m) => m.key);
    expect(keys).toEqual<ModeKey[]>([
      'sell',
      'make',
      'ship',
      'get_paid',
      'library',
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

  it('MAKE groups projects + manufacturing + production + receiving', () => {
    const paths = pathsFor('make');
    expect(paths).toContain('/3pl-operations/projects');
    expect(paths).toContain('/manufacturing/runs');
    expect(paths).toContain('/3pl-operations/production');
    expect(paths).toContain('/3pl-operations/receiving');
  });

  it('SHIP groups shipments and stock movements only', () => {
    const paths = pathsFor('ship');
    expect(paths).toContain('/3pl-operations/shipments');
    expect(paths).toContain('/3pl-operations/stock/movements');
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
    expect(paths).toContain('/3pl-operations/items');
    expect(paths).toContain('/3pl-operations/warehouses');
    // AP (no separate BUY mode — documented compromise).
    expect(paths).toContain('/3pl-operations/vendors');
    expect(paths).toContain('/3pl-operations/purchase-orders');
    expect(paths).toContain('/3pl-operations/vendor-bills');
    expect(paths).toContain('/3pl-operations/expenses');
  });

  it('Manufacturing route is gated behind plugins.manufacturing', () => {
    const make = SIDEBAR_MODES.find((m) => m.key === 'make');
    expect(make).toBeDefined();
    const mfg = make!.routes.find((r) => r.path === '/manufacturing/runs');
    expect(mfg?.requiresFlag).toBe(FEATURE_FLAGS.PLUGINS_MANUFACTURING);
  });

  it('Journal entries route is gated behind finance.journal_entries.enabled', () => {
    const gp = SIDEBAR_MODES.find((m) => m.key === 'get_paid');
    expect(gp).toBeDefined();
    const je = gp!.routes.find((r) => r.path === '/finance/journal-entries');
    expect(je?.requiresFlag).toBe(
      FEATURE_FLAGS.FINANCE_JOURNAL_ENTRIES_ENABLED,
    );
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
    expect(paths).toContain('/3pl-operations/production');
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

  it('keeps all routes in modes that have no flag-gated routes', () => {
    const ship = SIDEBAR_MODES.find((m) => m.key === 'ship')!;
    expect(visibleRoutesForMode(ship, {}).length).toBe(ship.routes.length);
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
  });

  it('matches detail/subpath URLs via prefix-with-slash', () => {
    expect(findActiveMode('/manufacturing/runs/abc-123')).toBe('make');
    expect(findActiveMode('/3pl-operations/quotes/xyz/send')).toBe('sell');
    expect(findActiveMode('/invoicing/invoices/i_1/send')).toBe('get_paid');
    expect(findActiveMode('/3pl-operations/items/new')).toBe('library');
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
