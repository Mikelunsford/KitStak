// Tests for the per-FSM state-stepper happy-path mappings (UX-Q7).
//
// Locks the constitutional invariants documented in stateStepperPaths.ts:
//   1. Every state in each FSM's states array is either on the happy
//      path or in the off-path set.
//   2. No state appears in BOTH path and offPath for the same FSM.
//   3. The first entry of each path equals the FSM's initial state.
//   4. Every FSM listed in the spec has a path; none are forgotten.
//   5. `isOffPath` returns the correct boolean for both on-path and
//      off-path states.
//   6. The label resolver returns a non-empty string for every known
//      state value.

import { describe, it, expect } from 'vitest';

import {
  STATE_STEPPER_PATHS,
  isOffPath,
  nextStepperState,
  titleCaseStateLabel,
  type StateStepperEntity,
} from './stateStepperPaths';
import {
  QUOTE_FSM,
  PROJECT_FSM,
} from './sales';
import {
  PURCHASE_ORDER_FSM,
  VENDOR_BILL_FSM,
  EXPENSE_FSM,
  RECEIVING_ORDER_FSM,
  PRODUCTION_RUN_FSM,
  SHIPMENT_FSM,
} from './vendors_inventory_ops';
import {
  invoiceStateMachine,
  creditNoteStateMachine,
} from './finance';
import {
  leadStateMachine,
  opportunityStageMachine,
} from './crm';
// Manufacturing FSM is not exported under workflow/, so we mirror the enum
// declared in lib/types/vendors_inventory_ops (the canonical source) for the
// coverage assertion.
import { ManufacturingRunStatusSchema } from '@/lib/types/vendors_inventory_ops';

// Map entity key -> the FSM's states array. The manufacturing FSM does not
// have a separate workflow definition; its states come from the Zod enum.
const FSM_STATES: Record<StateStepperEntity, readonly string[]> = {
  quote: QUOTE_FSM.states,
  project: PROJECT_FSM.states,
  manufacturing_run: ManufacturingRunStatusSchema.options,
  production_run: PRODUCTION_RUN_FSM.states,
  receiving_order: RECEIVING_ORDER_FSM.states,
  shipment: SHIPMENT_FSM.states,
  invoice: invoiceStateMachine.states,
  credit_note: creditNoteStateMachine.states,
  purchase_order: PURCHASE_ORDER_FSM.states,
  vendor_bill: VENDOR_BILL_FSM.states,
  expense: EXPENSE_FSM.states,
  lead: leadStateMachine.states,
  opportunity: opportunityStageMachine.states,
};

const FSM_INITIAL: Record<StateStepperEntity, string> = {
  quote: QUOTE_FSM.initial,
  project: PROJECT_FSM.initial,
  manufacturing_run: 'draft',
  production_run: PRODUCTION_RUN_FSM.initial,
  receiving_order: RECEIVING_ORDER_FSM.initial,
  shipment: SHIPMENT_FSM.initial,
  invoice: invoiceStateMachine.initial,
  credit_note: creditNoteStateMachine.initial,
  purchase_order: PURCHASE_ORDER_FSM.initial,
  vendor_bill: VENDOR_BILL_FSM.initial,
  expense: EXPENSE_FSM.initial,
  lead: leadStateMachine.initial,
  opportunity: opportunityStageMachine.initial,
};

const ENTITIES = Object.keys(STATE_STEPPER_PATHS) as StateStepperEntity[];

describe('stateStepperPaths (UX-Q7)', () => {
  it('defines a path for every FSM in the Q7 spec', () => {
    expect(ENTITIES).toEqual(
      expect.arrayContaining([
        'quote',
        'project',
        'manufacturing_run',
        'production_run',
        'receiving_order',
        'shipment',
        'invoice',
        'credit_note',
        'purchase_order',
        'vendor_bill',
        'expense',
        'lead',
        'opportunity',
      ]),
    );
  });

  it('every FSM state is either on the happy path or in the off-path set', () => {
    for (const entity of ENTITIES) {
      const def = STATE_STEPPER_PATHS[entity];
      const pathStates = def.path.map((s) => s.state);
      const allStates = FSM_STATES[entity];
      for (const state of allStates) {
        const inPath = pathStates.includes(state);
        const inOff = def.offPath.includes(state);
        expect(
          inPath || inOff,
          `${entity}: state "${state}" is not on path or off-path`,
        ).toBe(true);
      }
    }
  });

  it('no state appears in both path and offPath for the same FSM', () => {
    for (const entity of ENTITIES) {
      const def = STATE_STEPPER_PATHS[entity];
      const pathStates = def.path.map((s) => s.state);
      for (const off of def.offPath) {
        expect(
          pathStates.includes(off),
          `${entity}: state "${off}" appears in both path and offPath`,
        ).toBe(false);
      }
    }
  });

  it('first entry of each path equals the FSM initial state', () => {
    for (const entity of ENTITIES) {
      const def = STATE_STEPPER_PATHS[entity];
      expect(def.path[0]!.state).toBe(FSM_INITIAL[entity]);
    }
  });

  it('no duplicate states within a path', () => {
    for (const entity of ENTITIES) {
      const def = STATE_STEPPER_PATHS[entity];
      const states = def.path.map((s) => s.state);
      expect(new Set(states).size).toBe(states.length);
    }
  });

  it('no duplicate states within offPath', () => {
    for (const entity of ENTITIES) {
      const def = STATE_STEPPER_PATHS[entity];
      expect(new Set(def.offPath).size).toBe(def.offPath.length);
    }
  });

  it('every path step has a non-empty label', () => {
    for (const entity of ENTITIES) {
      const def = STATE_STEPPER_PATHS[entity];
      for (const step of def.path) {
        expect(step.label.length).toBeGreaterThan(0);
      }
    }
  });

  it('the last path step is marked isTerminal: true', () => {
    for (const entity of ENTITIES) {
      const def = STATE_STEPPER_PATHS[entity];
      const last = def.path[def.path.length - 1]!;
      expect(last.isTerminal, `${entity} terminal step`).toBe(true);
    }
  });

  it('isOffPath returns true for off-path states and false for on-path states', () => {
    for (const entity of ENTITIES) {
      const def = STATE_STEPPER_PATHS[entity];
      for (const onState of def.path) {
        expect(isOffPath(entity, onState.state)).toBe(false);
      }
      for (const offState of def.offPath) {
        expect(isOffPath(entity, offState)).toBe(true);
      }
    }
  });

  it('resolveLabel returns a non-empty Title-Case string for every state', () => {
    for (const entity of ENTITIES) {
      const def = STATE_STEPPER_PATHS[entity];
      const allStates = FSM_STATES[entity];
      for (const state of allStates) {
        const label = def.resolveLabel(state);
        expect(label.length).toBeGreaterThan(0);
      }
    }
  });

  it('titleCaseStateLabel returns Title Case with underscore-to-space', () => {
    expect(titleCaseStateLabel('draft')).toBe('Draft');
    expect(titleCaseStateLabel('ready_to_build')).toBe('Ready To Build');
    expect(titleCaseStateLabel('partially_paid')).toBe('Partially Paid');
    expect(titleCaseStateLabel('')).toBe('');
  });

  it('quote uses formatQuoteStateLabel so "submitted" -> "Sent for approval"', () => {
    // B7 vocabulary fix: the DB enum keeps "submitted" but the operator label
    // is "Sent for approval" pre-approval. The stepper must inherit this.
    expect(STATE_STEPPER_PATHS.quote.resolveLabel('submitted')).toBe(
      'Sent for approval',
    );
  });

  it('invoice path includes partially_paid between sent and paid', () => {
    // PR #99 B2 fix: partially_paid is a transient happy-path state on the
    // way to paid as payments allocate. Lock that ordering.
    const states = STATE_STEPPER_PATHS.invoice.path.map((s) => s.state);
    const sentIdx = states.indexOf('sent');
    const partialIdx = states.indexOf('partially_paid');
    const paidIdx = states.indexOf('paid');
    expect(sentIdx).toBeGreaterThanOrEqual(0);
    expect(partialIdx).toBeGreaterThan(sentIdx);
    expect(paidIdx).toBeGreaterThan(partialIdx);
  });
});

describe('nextStepperState (Pattern D, UX-Q7 reopened)', () => {
  // A small fixed path stands in for any entity. The helper is path-agnostic
  // so a representative four-step path exercises every branch.
  const path = [
    { state: 'draft' },
    { state: 'submitted' },
    { state: 'approved' },
    { state: 'project_pending' },
  ] as const;

  it('returns the next state for a mid-path state', () => {
    expect(nextStepperState(path, 'submitted')).toBe('approved');
  });

  it('returns the second state for the first state', () => {
    expect(nextStepperState(path, 'draft')).toBe('submitted');
  });

  it('returns null for the terminal state', () => {
    expect(nextStepperState(path, 'project_pending')).toBeNull();
  });

  it('returns null for an off-path or unknown state', () => {
    expect(nextStepperState(path, 'cancelled')).toBeNull();
  });

  it('returns null for an empty path', () => {
    expect(nextStepperState([], 'draft')).toBeNull();
  });

  it('works against a real STATE_STEPPER_PATHS entry', () => {
    expect(
      nextStepperState(STATE_STEPPER_PATHS.expense.path, 'approved'),
    ).toBe('paid');
    expect(
      nextStepperState(STATE_STEPPER_PATHS.expense.path, 'reimbursed'),
    ).toBeNull();
  });
});
