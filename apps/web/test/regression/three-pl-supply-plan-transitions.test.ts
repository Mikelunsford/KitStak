// Regression suite for the SUPPLY_PLAN FSM (3PL commercial layer, Phase A5).
//
// WHAT THIS TEST ACTUALLY COVERS, AND THE GAP IT DOCUMENTS
// --------------------------------------------------------
// Unlike MANUFACTURING_RUN_FSM and the finance FSMs, the 3PL supply_plan state
// machine has NO code-level `canTransition` guard. There is no SUPPLY_PLAN_FSM
// in apps/web/src/lib/workflow/ or supabase/functions/_shared/workflow/. The
// only code-level artifact for this entity is the SupplyPlanStatusSchema enum
// in the byte-mirrored types canon (apps/web/src/lib/types/threepl.ts ==
// supabase/functions/_shared/types/threepl.ts).
//
// Transition authority lives ENTIRELY in the database: the release / cancel /
// fulfill moves are SECURITY DEFINER RPCs (release_supply_plan,
// cancel_supply_plan, fulfill_supply_plan) that own the status CHECK and throw
// STATE_CONFLICT on an illegal move. The edge handler
// (supabase/functions/three-pl-api/handlers/supply_plans.ts) only relays that
// 409. The regression suite runs without a live DB, so it cannot exercise the
// RPC guard directly; the DB-level guard is covered by the migration tests
// (db-0096 / db-0101).
//
// Therefore this test pins the constraint that DOES exist at the code level:
// the canonical status enum set. It also documents the legal/illegal transition
// matrix as an explicit expectation table so that a future engineer who
// promotes supply_plan to a code-level FSM has the contract written down, and
// so that adding or removing a status value fails CI here.
//
// Risk closed: R-W14-TEST-05 (supply plan slice).
// Follow-up implied: a code-level SUPPLY_PLAN_FSM + canTransition guard mirrored
// SPA/_shared would let this suite assert transitions the way the manufacturing
// suite does. Today the only honest code-level assertion is the enum set.

import { describe, it, expect } from 'vitest';

import {
  SupplyPlanStatusSchema,
  type SupplyPlanStatus,
} from '../../src/lib/types/threepl';

// The canonical status set, pinned. This is the code-level constraint.
const STATES: ReadonlyArray<SupplyPlanStatus> = [
  'draft',
  'released',
  'fulfilled',
  'cancelled',
];

// Documented (DB-enforced) transition contract for supply_plan. This is the
// authority the RPCs implement; it is NOT enforced by any code-level helper.
// Kept here as the written contract and as the target for a future code FSM.
//   draft     -> released   (release_supply_plan: reserves stock)
//   draft     -> cancelled  (cancel_supply_plan)
//   released  -> fulfilled  (fulfill_supply_plan: releases remaining holds)
//   released  -> cancelled  (cancel_supply_plan)
// Terminal: fulfilled, cancelled.
const DOCUMENTED_ALLOWED: Record<SupplyPlanStatus, ReadonlyArray<SupplyPlanStatus>> = {
  draft: ['released', 'cancelled'],
  released: ['fulfilled', 'cancelled'],
  fulfilled: [],
  cancelled: [],
};

describe('SupplyPlanStatusSchema enum (code-level constraint)', () => {
  it('admits exactly the four canonical states', () => {
    expect([...SupplyPlanStatusSchema.options]).toEqual([
      'draft',
      'released',
      'fulfilled',
      'cancelled',
    ]);
  });

  it('accepts every canonical state', () => {
    for (const s of STATES) {
      expect(SupplyPlanStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  it('rejects an unknown state value', () => {
    expect(SupplyPlanStatusSchema.safeParse('shipped').success).toBe(false);
    expect(SupplyPlanStatusSchema.safeParse('').success).toBe(false);
  });

  it('declares draft as the create-time initial status', () => {
    // The list/create handler stamps status: 'draft' at insert; pin that the
    // initial state is a member of the enum.
    expect(SupplyPlanStatusSchema.safeParse('draft').success).toBe(true);
  });
});

describe('SUPPLY_PLAN documented transition matrix (DB-enforced, not code-guarded)', () => {
  // These assertions lock the WRITTEN contract: every from-state's documented
  // targets must be valid enum members, and the terminal states have none.
  // This is a structural integrity check on the documentation table above, not
  // a behavioural check of a code-level guard (none exists; see header).
  it('every documented target is a valid enum member', () => {
    for (const from of STATES) {
      for (const to of DOCUMENTED_ALLOWED[from]) {
        expect(STATES).toContain(to);
      }
    }
  });

  it('fulfilled and cancelled are terminal (no documented outgoing edges)', () => {
    expect(DOCUMENTED_ALLOWED.fulfilled).toEqual([]);
    expect(DOCUMENTED_ALLOWED.cancelled).toEqual([]);
  });

  it('draft is the only non-terminal entry state with an outgoing release edge', () => {
    expect(DOCUMENTED_ALLOWED.draft).toContain('released');
  });
});
