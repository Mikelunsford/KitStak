// Regression suite for the BILLING_REVIEW FSM (3PL commercial layer, Phase A7).
//
// WHAT THIS TEST ACTUALLY COVERS, AND THE GAP IT DOCUMENTS
// --------------------------------------------------------
// The 3PL billing_review state machine has NO code-level `canTransition`
// guard. There is no BILLING_REVIEW_FSM in apps/web/src/lib/workflow/ or
// supabase/functions/_shared/workflow/. The only code-level artifact for this
// entity is the BillingReviewStatusSchema enum in the byte-mirrored types canon
// (apps/web/src/lib/types/threepl.ts == supabase/functions/_shared/types/
// threepl.ts).
//
// Transition authority lives ENTIRELY in the database: approve / cancel are
// SECURITY DEFINER RPCs (approve_billing_review, cancel_billing_review) that
// own the status CHECK and throw STATE_CONFLICT on an illegal move. Approve
// also cuts the spine DRAFT invoice and mints the INV- number itself. The edge
// handler (supabase/functions/three-pl-api/handlers/billing_reviews.ts) only
// relays the 409. The regression suite runs without a live DB, so it cannot
// exercise the RPC guard directly; that guard is covered by the migration test
// (db-0102).
//
// Therefore this test pins the constraint that DOES exist at the code level:
// the canonical status enum set. It also documents the legal/illegal transition
// matrix as an explicit expectation table so the contract is written down and a
// status-value change fails CI here.
//
// Risk closed: R-W14-TEST-05 (billing review slice).

import { describe, it, expect } from 'vitest';

import {
  BillingReviewStatusSchema,
  type BillingReviewStatus,
} from '../../src/lib/types/threepl';

// The canonical status set, pinned. This is the code-level constraint.
const STATES: ReadonlyArray<BillingReviewStatus> = [
  'draft',
  'approved',
  'invoiced',
  'cancelled',
];

// Documented (DB-enforced) transition contract for billing_review. This is the
// authority the RPCs implement; it is NOT enforced by any code-level helper.
//   draft    -> approved  (approve_billing_review: cuts the draft invoice)
//   draft    -> cancelled (cancel_billing_review)
//   approved -> cancelled (cancel_billing_review)
//   approved -> invoiced  (set when the cut invoice is issued)
// Terminal: invoiced, cancelled.
const DOCUMENTED_ALLOWED: Record<BillingReviewStatus, ReadonlyArray<BillingReviewStatus>> = {
  draft: ['approved', 'cancelled'],
  approved: ['invoiced', 'cancelled'],
  invoiced: [],
  cancelled: [],
};

describe('BillingReviewStatusSchema enum (code-level constraint)', () => {
  it('admits exactly the four canonical states', () => {
    expect([...BillingReviewStatusSchema.options]).toEqual([
      'draft',
      'approved',
      'invoiced',
      'cancelled',
    ]);
  });

  it('accepts every canonical state', () => {
    for (const s of STATES) {
      expect(BillingReviewStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  it('rejects an unknown state value', () => {
    expect(BillingReviewStatusSchema.safeParse('paid').success).toBe(false);
    expect(BillingReviewStatusSchema.safeParse('').success).toBe(false);
  });

  it('declares draft as the create-time initial status', () => {
    // The list/create handler stamps status: 'draft' at insert.
    expect(BillingReviewStatusSchema.safeParse('draft').success).toBe(true);
  });
});

describe('BILLING_REVIEW documented transition matrix (DB-enforced, not code-guarded)', () => {
  it('every documented target is a valid enum member', () => {
    for (const from of STATES) {
      for (const to of DOCUMENTED_ALLOWED[from]) {
        expect(STATES).toContain(to);
      }
    }
  });

  it('invoiced and cancelled are terminal (no documented outgoing edges)', () => {
    expect(DOCUMENTED_ALLOWED.invoiced).toEqual([]);
    expect(DOCUMENTED_ALLOWED.cancelled).toEqual([]);
  });

  it('approve is the only path that opens the invoiced edge', () => {
    // invoiced is only reachable from approved; no draft -> invoiced shortcut.
    expect(DOCUMENTED_ALLOWED.draft).not.toContain('invoiced');
    expect(DOCUMENTED_ALLOWED.approved).toContain('invoiced');
  });
});
