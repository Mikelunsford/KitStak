// Regression suite for UX-Q4 — promote the "next step" CTA on every detail
// page so the operator follows the workflow forward without ever returning
// to a list. From the 2026-05-21 UX revision walk.
//
// Targets the four predicate helpers in
// `apps/web/src/lib/workflow/nextStepCTA.ts`, which the four detail pages
// (QuoteDetailPage, ProjectDetailPage, ShipmentDetailPage, InvoiceDetailPage)
// import as their source of truth for when the NextStepCTA renders.
//
// Constitutional invariant protected: a drift in either direction (CTA
// absent on a triggering state OR CTA visible on a non-triggering state)
// regresses UX-Q4. The shared FSM schemas drive these tests so that adding
// a new state to a state machine without updating the predicate fails CI.

import { describe, it, expect } from 'vitest';

import {
  shouldShowQuoteNextStepCTA,
  shouldShowProjectNextStepCTA,
  shouldShowShipmentNextStepCTA,
  shouldShowInvoiceNextStepCTA,
} from '../../src/lib/workflow/nextStepCTA';
import { QuoteStateSchema, ProjectStateSchema } from '../../src/lib/types/sales';
import { ShipmentStatusSchema } from '../../src/lib/types/vendors_inventory_ops';
import { InvoiceStatusSchema } from '../../src/lib/types/finance';

describe('shouldShowQuoteNextStepCTA (Convert to project)', () => {
  it('returns true for approved', () => {
    expect(shouldShowQuoteNextStepCTA('approved')).toBe(true);
  });

  it('returns false for every other state', () => {
    const states = QuoteStateSchema.options.filter((s) => s !== 'approved');
    for (const s of states) {
      expect(shouldShowQuoteNextStepCTA(s)).toBe(false);
    }
  });
});

describe('shouldShowProjectNextStepCTA (Create shipment)', () => {
  it('returns true for ready_to_ship', () => {
    expect(shouldShowProjectNextStepCTA('ready_to_ship')).toBe(true);
  });

  it('returns false for every other state', () => {
    const states = ProjectStateSchema.options.filter((s) => s !== 'ready_to_ship');
    for (const s of states) {
      expect(shouldShowProjectNextStepCTA(s)).toBe(false);
    }
  });
});

describe('shouldShowShipmentNextStepCTA (Create invoice)', () => {
  it('returns true for shipped', () => {
    expect(shouldShowShipmentNextStepCTA('shipped')).toBe(true);
  });

  it('returns false for every other status', () => {
    const states = ShipmentStatusSchema.options.filter((s) => s !== 'shipped');
    for (const s of states) {
      expect(shouldShowShipmentNextStepCTA(s)).toBe(false);
    }
  });
});

describe('shouldShowInvoiceNextStepCTA (Receive payment)', () => {
  const triggering: ReadonlyArray<'sent' | 'partially_paid' | 'overdue'> = [
    'sent',
    'partially_paid',
    'overdue',
  ];

  for (const s of triggering) {
    it(`returns true for ${s}`, () => {
      expect(shouldShowInvoiceNextStepCTA(s)).toBe(true);
    });
  }

  it('returns false for every other status', () => {
    const states = InvoiceStatusSchema.options.filter(
      (s) => !triggering.includes(s as typeof triggering[number]),
    );
    expect(states.length).toBeGreaterThan(0);
    for (const s of states) {
      expect(shouldShowInvoiceNextStepCTA(s)).toBe(false);
    }
  });
});
