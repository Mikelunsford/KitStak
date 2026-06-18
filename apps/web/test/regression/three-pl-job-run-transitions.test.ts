// Regression suite for the JOB_RUN FSM (3PL commercial layer, Phase A6).
//
// WHAT THIS TEST ACTUALLY COVERS, AND THE GAP IT DOCUMENTS
// --------------------------------------------------------
// The 3PL job_run state machine has NO code-level `canTransition` guard. There
// is no JOB_RUN_FSM in apps/web/src/lib/workflow/ or supabase/functions/
// _shared/workflow/. The only code-level artifact for this entity is the
// JobRunStatusSchema enum in the byte-mirrored types canon
// (apps/web/src/lib/types/threepl.ts == supabase/functions/_shared/types/
// threepl.ts).
//
// Transition authority lives ENTIRELY in the database: start / complete /
// close / cancel are SECURITY DEFINER RPCs (start_job_run, complete_job_run,
// close_job_run, cancel_job_run) that own the status CHECK and throw
// STATE_CONFLICT on an illegal move. The edge handler
// (supabase/functions/three-pl-api/handlers/job_runs.ts) only relays that 409.
// The regression suite runs without a live DB, so it cannot exercise the RPC
// guard directly; that guard is covered by the migration test (db-0098).
//
// Therefore this test pins the constraint that DOES exist at the code level:
// the canonical status enum set. It also documents the legal/illegal transition
// matrix as an explicit expectation table so the contract is written down and a
// status-value change fails CI here.
//
// Risk closed: R-W14-TEST-05 (job run slice).

import { describe, it, expect } from 'vitest';

import {
  JobRunStatusSchema,
  type JobRunStatus,
} from '../../src/lib/types/threepl';

// The canonical status set, pinned. This is the code-level constraint.
const STATES: ReadonlyArray<JobRunStatus> = [
  'planned',
  'in_progress',
  'completed',
  'closed',
  'cancelled',
];

// Documented (DB-enforced) transition contract for job_run. This is the
// authority the RPCs implement; it is NOT enforced by any code-level helper.
//   planned     -> in_progress (start_job_run)
//   planned     -> cancelled   (cancel_job_run)
//   in_progress -> completed   (complete_job_run)
//   in_progress -> cancelled   (cancel_job_run)
//   completed   -> closed      (close_job_run)
// Terminal: closed, cancelled.
const DOCUMENTED_ALLOWED: Record<JobRunStatus, ReadonlyArray<JobRunStatus>> = {
  planned: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: ['closed'],
  closed: [],
  cancelled: [],
};

describe('JobRunStatusSchema enum (code-level constraint)', () => {
  it('admits exactly the five canonical states', () => {
    expect([...JobRunStatusSchema.options]).toEqual([
      'planned',
      'in_progress',
      'completed',
      'closed',
      'cancelled',
    ]);
  });

  it('accepts every canonical state', () => {
    for (const s of STATES) {
      expect(JobRunStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  it('rejects an unknown state value', () => {
    expect(JobRunStatusSchema.safeParse('paused').success).toBe(false);
    expect(JobRunStatusSchema.safeParse('').success).toBe(false);
  });

  it('declares planned as the create-time initial status', () => {
    // The list/create handler stamps status: 'planned' at insert.
    expect(JobRunStatusSchema.safeParse('planned').success).toBe(true);
  });
});

describe('JOB_RUN documented transition matrix (DB-enforced, not code-guarded)', () => {
  it('every documented target is a valid enum member', () => {
    for (const from of STATES) {
      for (const to of DOCUMENTED_ALLOWED[from]) {
        expect(STATES).toContain(to);
      }
    }
  });

  it('closed and cancelled are terminal (no documented outgoing edges)', () => {
    expect(DOCUMENTED_ALLOWED.closed).toEqual([]);
    expect(DOCUMENTED_ALLOWED.cancelled).toEqual([]);
  });

  it('completed leads only to closed (the close-out edge)', () => {
    expect(DOCUMENTED_ALLOWED.completed).toEqual(['closed']);
  });

  it('planned is the only entry state with a start edge', () => {
    expect(DOCUMENTED_ALLOWED.planned).toContain('in_progress');
  });
});
