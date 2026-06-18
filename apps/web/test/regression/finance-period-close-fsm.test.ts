// Regression suite for the period_close FSM in the finance workflow canon.
//
// The period_close state machine lives in the byte-mirrored finance workflow
// canon (apps/web/src/lib/workflow/finance.ts == supabase/functions/_shared/
// workflow/finance.ts) as periodCloseStateMachine, and is the single source of
// truth the SPA consults via canFinanceTransition() to hide invalid buttons.
// The DB owns the authoritative text CHECK constraint plus the audit trigger
// (AUDIT row 65); this canon mirrors it.
//
// This test is the guard that the canon cannot silently drift. It pins the
// four canonical states and the exact allowed-transition set so that adding,
// removing, or re-routing a transition fails CI rather than slipping through.
// It imports the real module; it never hardcodes a copy of the FSM.
//
// Risk closed: R-W14-TEST-03.
// Constitutional invariant protected: the period_close FSM transitions are
// frozen here. A change to them is a deliberate, reviewed canon edit, never an
// accidental drift away from the DB CHECK constraint and audit guard.

import { describe, it, expect } from 'vitest';

import {
  periodCloseStateMachine,
  canFinanceTransition,
  FINANCE_FSMS,
  type PeriodCloseState,
} from '../../src/lib/workflow/finance';

// The full state set, used to derive the illegal transitions exhaustively.
const ALL_STATES: ReadonlyArray<PeriodCloseState> = [
  'open',
  'in_review',
  'closed',
  'reopened',
];

// The authoritative allowed-set, mirroring the canon and the DB CHECK.
// Note: canFinanceTransition treats from === to as legal (idempotent
// no-op), so a self-edge is NOT included here; the allowed-set matrix
// below filters self-edges out before comparing.
const ALLOWED: Record<PeriodCloseState, ReadonlyArray<PeriodCloseState>> = {
  open: ['in_review', 'closed'],
  in_review: ['closed'],
  closed: ['reopened'],
  reopened: ['closed'],
};

describe('periodCloseStateMachine shape', () => {
  it('declares the period_close entity and open initial state', () => {
    expect(periodCloseStateMachine.entity).toBe('period_close');
    expect(periodCloseStateMachine.initial).toBe('open');
  });

  it('declares exactly the four canonical states', () => {
    expect([...periodCloseStateMachine.states]).toEqual([
      'open',
      'in_review',
      'closed',
      'reopened',
    ]);
  });

  it('declares exactly the five canonical transitions', () => {
    expect(periodCloseStateMachine.transitions).toHaveLength(5);
  });

  it('is registered in the finance canon under the period_close key', () => {
    expect(FINANCE_FSMS.period_close).toBe(periodCloseStateMachine);
  });
});

describe('periodCloseStateMachine legal transitions return true', () => {
  it('open -> in_review (start_review)', () => {
    expect(canFinanceTransition(periodCloseStateMachine, 'open', 'in_review')).toBe(true);
  });

  it('in_review -> closed (close)', () => {
    expect(canFinanceTransition(periodCloseStateMachine, 'in_review', 'closed')).toBe(true);
  });

  it('open -> closed (close, fast path)', () => {
    expect(canFinanceTransition(periodCloseStateMachine, 'open', 'closed')).toBe(true);
  });

  it('closed -> reopened (reopen)', () => {
    expect(canFinanceTransition(periodCloseStateMachine, 'closed', 'reopened')).toBe(true);
  });

  it('reopened -> closed (close)', () => {
    expect(canFinanceTransition(periodCloseStateMachine, 'reopened', 'closed')).toBe(true);
  });
});

describe('periodCloseStateMachine illegal transitions return false', () => {
  it('in_review -> open (no rewind to open)', () => {
    expect(canFinanceTransition(periodCloseStateMachine, 'in_review', 'open')).toBe(false);
  });

  it('open -> reopened (reopen only from closed)', () => {
    expect(canFinanceTransition(periodCloseStateMachine, 'open', 'reopened')).toBe(false);
  });

  it('closed -> in_review (cannot re-review a closed period directly)', () => {
    expect(canFinanceTransition(periodCloseStateMachine, 'closed', 'in_review')).toBe(false);
  });

  it('reopened -> in_review (no re-review of a reopened period)', () => {
    expect(canFinanceTransition(periodCloseStateMachine, 'reopened', 'in_review')).toBe(false);
  });

  it('reopened -> open (no rewind to open)', () => {
    expect(canFinanceTransition(periodCloseStateMachine, 'reopened', 'open')).toBe(false);
  });

  it('in_review -> reopened (reopen only from closed)', () => {
    expect(canFinanceTransition(periodCloseStateMachine, 'in_review', 'reopened')).toBe(false);
  });
});

describe('periodCloseStateMachine allowed-set matches the canon exactly', () => {
  // For every (from, to) pair where from !== to, canFinanceTransition must
  // agree with ALLOWED. Self-edges are excluded because canFinanceTransition
  // returns true for from === to by contract. This is the exhaustive drift
  // guard: any extra or missing transition fails here.
  for (const from of ALL_STATES) {
    it(`from=${from} allows exactly [${ALLOWED[from].join(', ')}]`, () => {
      const actual = ALL_STATES.filter(
        (to) => to !== from && canFinanceTransition(periodCloseStateMachine, from, to),
      );
      expect(actual).toEqual([...ALLOWED[from]]);
    });
  }
});
