// Unit tests for the SetupChecklist pure helper.
//
// Pure (no React) per the repo no-jsdom convention, matching the pattern
// in dashboardWorkCards.test.ts. The factory carries every field on
// DashboardSummary so a future Zod addition surfaces here as a TS error
// rather than a silent default-shift in test fixtures.

import { describe, it, expect } from 'vitest';

import {
  buildSetupSteps,
  countCompletedSetupSteps,
  isSetupComplete,
  SETUP_STEPS_TOTAL,
} from './dashboardChecklistSteps';
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

describe('SETUP_STEPS_TOTAL', () => {
  it('locks the canonical step count at 8', () => {
    expect(SETUP_STEPS_TOTAL).toBe(8);
  });
});

describe('buildSetupSteps', () => {
  it('emits eight steps in the canonical prerequisite order', () => {
    const steps = buildSetupSteps(summary());
    expect(steps.map((s) => s.key)).toEqual([
      'warehouse_added',
      'customer_added',
      'item_added',
      'quote_created',
      'receiving_received',
      'invoice_sent',
      'payment_received',
      'team_invited',
    ]);
  });

  it('threads each boolean through from the summary payload', () => {
    const steps = buildSetupSteps(
      summary({
        setup_warehouse_added: true,
        setup_customer_added: true,
        setup_item_added: false,
        setup_quote_created: false,
        setup_receiving_received: false,
        setup_invoice_sent: false,
        setup_payment_received: false,
      }),
    );
    const completed = steps.filter((s) => s.isComplete).map((s) => s.key);
    expect(completed).toEqual(['warehouse_added', 'customer_added']);
  });

  it('produces deep-link routes matching existing create or list pages', () => {
    const byKey = new Map(
      buildSetupSteps(summary()).map((s) => [s.key, s.to]),
    );
    // Step 1 routes to the warehouses LIST (not /new) because the default
    // warehouse already exists; the operator wants to rename or add a peer,
    // not create another DEFAULT.
    expect(byKey.get('warehouse_added')).toBe('/inventory/warehouses');
    expect(byKey.get('customer_added')).toBe('/crm/customers/new');
    expect(byKey.get('item_added')).toBe('/3pl-operations/items/new');
    expect(byKey.get('quote_created')).toBe('/3pl-operations/quotes/new');
    expect(byKey.get('receiving_received')).toBe(
      '/3pl-operations/receiving/new',
    );
    expect(byKey.get('invoice_sent')).toBe('/invoicing/invoices/new');
    expect(byKey.get('payment_received')).toBe('/3pl-operations/payments/new');
    expect(byKey.get('team_invited')).toBe('/admin/members');
  });

  it('uses operator-readable copy (no em dash, no double hyphen, no emoji)', () => {
    for (const step of buildSetupSteps(summary())) {
      expect(step.label).not.toMatch(/—|--/);
      expect(step.helperCopy).not.toMatch(/—|--/);
      // Emoji guard: brand discipline applies to all on-disk copy.
      expect(step.label).not.toMatch(/[\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]/u);
      expect(step.helperCopy).not.toMatch(
        /[\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]/u,
      );
    }
  });

  it('mentions the default warehouse in step 1 helper copy', () => {
    const steps = buildSetupSteps(summary());
    const warehouseStep = steps[0];
    expect(warehouseStep).toBeDefined();
    expect(warehouseStep?.helperCopy.toLowerCase()).toContain('default');
  });
});

describe('countCompletedSetupSteps', () => {
  it('returns zero when no steps are complete', () => {
    expect(countCompletedSetupSteps(summary())).toBe(0);
  });

  it('returns the count of true flags', () => {
    expect(
      countCompletedSetupSteps(
        summary({
          setup_warehouse_added: true,
          setup_customer_added: true,
          setup_item_added: true,
        }),
      ),
    ).toBe(3);
  });

  it('returns SETUP_STEPS_TOTAL when every flag is true', () => {
    expect(
      countCompletedSetupSteps(
        summary({
          setup_warehouse_added: true,
          setup_customer_added: true,
          setup_item_added: true,
          setup_quote_created: true,
          setup_receiving_received: true,
          setup_invoice_sent: true,
          setup_payment_received: true,
          setup_team_invited: true,
        }),
      ),
    ).toBe(SETUP_STEPS_TOTAL);
  });
});

describe('isSetupComplete', () => {
  it('returns false when any step is incomplete', () => {
    expect(isSetupComplete(summary())).toBe(false);
    expect(
      isSetupComplete(
        summary({
          setup_warehouse_added: true,
          setup_customer_added: true,
          setup_item_added: true,
          setup_quote_created: true,
          setup_receiving_received: true,
          setup_invoice_sent: true,
          setup_payment_received: true,
          // setup_team_invited still false
        }),
      ),
    ).toBe(false);
  });

  it('returns true only when every step is complete', () => {
    expect(
      isSetupComplete(
        summary({
          setup_warehouse_added: true,
          setup_customer_added: true,
          setup_item_added: true,
          setup_quote_created: true,
          setup_receiving_received: true,
          setup_invoice_sent: true,
          setup_payment_received: true,
          setup_team_invited: true,
        }),
      ),
    ).toBe(true);
  });
});
