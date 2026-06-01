// Regression suite for MANUFACTURING_RUN_FSM in the workflow canon.
//
// The manufacturing_run state machine lives in the byte-mirrored workflow
// canon (apps/web/src/lib/workflow.ts == supabase/functions/_shared/workflow.ts)
// and is the single source of truth the manufacturing-api handler consults via
// assertManufacturingTransition -> canTransition(MANUFACTURING_RUN_FSM, ...).
//
// This test is the guard that the canon and the handler cannot silently drift.
// It pins the exact allowed-transition set so that:
//   * adding a state or transition to the FSM without updating the handler /
//     intent fails CI, and
//   * the legal set stays equal to the manufacturing_runs CHECK constraint and
//     audit-trigger guard from migration 0052 (draft -> started -> completed;
//     draft|started -> cancelled; completed and cancelled terminal).
//
// Constitutional invariant protected: the manufacturing_run FSM transitions are
// frozen here. A change to them is a deliberate, reviewed canon edit, never an
// accidental handler drift.

import { describe, it, expect } from 'vitest';

import {
  MANUFACTURING_RUN_FSM,
  canTransition,
  type ManufacturingRunStatus,
} from '../../src/lib/workflow';

// The full state set, used to derive the illegal transitions exhaustively.
const ALL_STATES: ReadonlyArray<ManufacturingRunStatus> = [
  'draft',
  'started',
  'completed',
  'cancelled',
];

// The authoritative allowed-set, mirroring migration 0052 and the handler.
const ALLOWED: Record<ManufacturingRunStatus, ReadonlyArray<ManufacturingRunStatus>> = {
  draft: ['started', 'cancelled'],
  started: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

describe('MANUFACTURING_RUN_FSM shape', () => {
  it('declares the manufacturing_run entity and draft initial state', () => {
    expect(MANUFACTURING_RUN_FSM.entity).toBe('manufacturing_run');
    expect(MANUFACTURING_RUN_FSM.initial).toBe('draft');
  });

  it('declares exactly the four canonical states', () => {
    expect([...MANUFACTURING_RUN_FSM.states]).toEqual([
      'draft',
      'started',
      'completed',
      'cancelled',
    ]);
  });

  it('is registered in the workflow canon under the manufacturing_run key', async () => {
    const { FSMS } = await import('../../src/lib/workflow');
    expect(FSMS.manufacturing_run).toBe(MANUFACTURING_RUN_FSM);
  });
});

describe('MANUFACTURING_RUN_FSM legal transitions return true', () => {
  it('draft -> started (start)', () => {
    expect(canTransition(MANUFACTURING_RUN_FSM, 'draft', 'started')).toBe(true);
  });

  it('draft -> cancelled (cancel)', () => {
    expect(canTransition(MANUFACTURING_RUN_FSM, 'draft', 'cancelled')).toBe(true);
  });

  it('started -> completed (complete)', () => {
    expect(canTransition(MANUFACTURING_RUN_FSM, 'started', 'completed')).toBe(true);
  });

  it('started -> cancelled (cancel)', () => {
    expect(canTransition(MANUFACTURING_RUN_FSM, 'started', 'cancelled')).toBe(true);
  });
});

describe('MANUFACTURING_RUN_FSM illegal transitions return false', () => {
  it('draft -> completed (must pass through started)', () => {
    expect(canTransition(MANUFACTURING_RUN_FSM, 'draft', 'completed')).toBe(false);
  });

  it('completed -> started (completed is terminal)', () => {
    expect(canTransition(MANUFACTURING_RUN_FSM, 'completed', 'started')).toBe(false);
  });

  it('completed -> anything (completed is terminal)', () => {
    for (const to of ALL_STATES) {
      expect(canTransition(MANUFACTURING_RUN_FSM, 'completed', to)).toBe(false);
    }
  });

  it('cancelled -> anything (cancelled is terminal)', () => {
    for (const to of ALL_STATES) {
      expect(canTransition(MANUFACTURING_RUN_FSM, 'cancelled', to)).toBe(false);
    }
  });

  it('started -> started (no self-loop)', () => {
    expect(canTransition(MANUFACTURING_RUN_FSM, 'started', 'started')).toBe(false);
  });
});

describe('MANUFACTURING_RUN_FSM allowed-set matches the canon exactly', () => {
  // For every (from, to) pair, canTransition must agree with ALLOWED. This is
  // the exhaustive drift guard: any extra or missing transition fails here.
  for (const from of ALL_STATES) {
    it(`from=${from} allows exactly [${ALLOWED[from].join(', ')}]`, () => {
      const actual = ALL_STATES.filter((to) =>
        canTransition(MANUFACTURING_RUN_FSM, from, to),
      );
      expect(actual).toEqual([...ALLOWED[from]]);
    });
  }
});
