// UX-Q5: unit tests for the dashboard work-card helper.
//
// The helper is intentionally pure (no React) so the empty-state heuristic
// and the deep-link routes can be locked in without a DOM renderer, matching
// the repo's existing no-jsdom convention (see lib/hooks/featureFlagResolver
// .test.ts for the same pattern).

import { describe, it, expect } from 'vitest';

import {
  buildOnboardingCards,
  buildWorkCards,
  isAllCountsZero,
} from './dashboardWorkCards';
import type { DashboardSummary } from '@/lib/types/cross_cutting';

function summary(
  overrides: Partial<DashboardSummary> = {},
): DashboardSummary {
  return {
    open_invoices_count: 0,
    ar_balance_cents: '0',
    overdue_invoices_count: 0,
    open_quotes_count: 0,
    in_flight_receiving_count: 0,
    in_flight_shipments_count: 0,
    active_projects_count: 0,
    currency_code: 'USD',
    quotes_awaiting_approval_count: 0,
    runs_in_production_count: 0,
    shipments_ready_to_ship_count: 0,
    unpaid_invoices_count: 0,
    // Setup checklist booleans added in the SetupChecklist PR. Defaults to
    // false so the existing tests' "every count zero" fixture continues to
    // model a fresh org.
    setup_warehouse_added: false,
    setup_customer_added: false,
    setup_item_added: false,
    setup_quote_created: false,
    setup_receiving_received: false,
    setup_invoice_sent: false,
    setup_payment_received: false,
    setup_team_invited: false,
    ...overrides,
  };
}

describe('buildWorkCards', () => {
  it('emits four cards in the operator-flow order', () => {
    const cards = buildWorkCards(summary());
    expect(cards.map((c) => c.key)).toEqual([
      'quotes_awaiting_approval',
      'runs_in_production',
      'shipments_ready_to_ship',
      'unpaid_invoices',
    ]);
  });

  it('threads each count through from the summary payload', () => {
    const cards = buildWorkCards(
      summary({
        quotes_awaiting_approval_count: 3,
        runs_in_production_count: 1,
        shipments_ready_to_ship_count: 2,
        unpaid_invoices_count: 7,
      }),
    );
    expect(cards.find((c) => c.key === 'quotes_awaiting_approval')?.count).toBe(
      3,
    );
    expect(cards.find((c) => c.key === 'runs_in_production')?.count).toBe(1);
    expect(cards.find((c) => c.key === 'shipments_ready_to_ship')?.count).toBe(
      2,
    );
    expect(cards.find((c) => c.key === 'unpaid_invoices')?.count).toBe(7);
  });

  it('produces stable deep-link routes matching the UX revision spec', () => {
    const byKey = new Map(buildWorkCards(summary()).map((c) => [c.key, c.to]));
    expect(byKey.get('quotes_awaiting_approval')).toBe(
      '/3pl-operations/quotes?state=submitted',
    );
    expect(byKey.get('runs_in_production')).toBe(
      '/manufacturing/runs?status=started',
    );
    expect(byKey.get('shipments_ready_to_ship')).toBe(
      '/3pl-operations/shipments?status=picking',
    );
    expect(byKey.get('unpaid_invoices')).toBe(
      '/invoicing/invoices?status=sent',
    );
  });

  it('uses operator-readable labels (no em dash, no double hyphen)', () => {
    for (const card of buildWorkCards(summary())) {
      expect(card.label).not.toMatch(/—|--/);
      expect(card.label.length).toBeGreaterThan(0);
    }
  });
});

describe('isAllCountsZero', () => {
  it('returns true when every work-card count is zero', () => {
    expect(isAllCountsZero(summary())).toBe(true);
  });

  it('returns false the moment any work-card count is positive', () => {
    expect(
      isAllCountsZero(summary({ quotes_awaiting_approval_count: 1 })),
    ).toBe(false);
    expect(isAllCountsZero(summary({ runs_in_production_count: 5 }))).toBe(
      false,
    );
    expect(
      isAllCountsZero(summary({ shipments_ready_to_ship_count: 2 })),
    ).toBe(false);
    expect(isAllCountsZero(summary({ unpaid_invoices_count: 1 }))).toBe(false);
  });

  it('treats negative and non-finite counts as zero (defensive)', () => {
    // We never expect a Zod-parsed summary to carry these, but the
    // empty-state branch is load-bearing for the onboarding cards. A
    // single non-positive value should not flip the dashboard out of
    // its empty state on its own.
    expect(
      isAllCountsZero(
        summary({
          quotes_awaiting_approval_count: -1 as unknown as number,
        }),
      ),
    ).toBe(true);
    expect(
      isAllCountsZero(
        summary({
          runs_in_production_count: Number.NaN as unknown as number,
        }),
      ),
    ).toBe(true);
  });
});

describe('buildOnboardingCards', () => {
  it('returns exactly four onboarding cards with reachable routes', () => {
    const cards = buildOnboardingCards();
    expect(cards.length).toBe(4);
    const routes = cards.map((c) => c.to);
    // Routes must exist in apps/web/src/routes.ts; the spec is explicit
    // that we do not invent destinations.
    expect(routes).toContain('/crm/customers/new');
    expect(routes).toContain('/3pl-operations/items/new');
    expect(routes).toContain('/3pl-operations/quotes/new');
    expect(routes).toContain('/admin/settings');
  });

  it('has helper text on every onboarding card', () => {
    for (const card of buildOnboardingCards()) {
      expect(card.helperText.length).toBeGreaterThan(0);
      // Brand rule: no em dash, no double hyphen, no emoji in copy.
      expect(card.helperText).not.toMatch(/—|--/);
    }
  });

  it('emits stable keys discriminated per card', () => {
    const keys = buildOnboardingCards().map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual([
      'create_customer',
      'add_inventory_item',
      'create_quote',
      'invite_teammate',
    ]);
  });
});
