// Sales-domain workflow canon. Byte-mirror of apps/web/src/lib/workflow/sales.ts.
// 6-state quote machine + 6-state project machine + 4-state project_phase
// machine. Server is authority; the SPA hides invalid buttons but the
// server rejects illegal transitions through CHECK constraints and the
// audit trigger.

export type FsmTransition<S extends string> = {
  from: S;
  to: S;
  action: string;
};

export type Fsm<S extends string> = {
  entity: string;
  initial: S;
  states: readonly S[];
  transitions: readonly FsmTransition<S>[];
};

// ---------------------------------------------------------------------------
// quote machine: draft -> submitted -> approved -> project_pending.
// revise_requested branches off submitted; cancelled is a sink reachable
// from any pre-conversion state.
// ---------------------------------------------------------------------------

export type QuoteState =
  | 'draft'
  | 'submitted'
  | 'revise_requested'
  | 'approved'
  | 'project_pending'
  | 'cancelled';

export const QUOTE_FSM: Fsm<QuoteState> = {
  entity: 'quote',
  initial: 'draft',
  states: [
    'draft', 'submitted', 'revise_requested',
    'approved', 'project_pending', 'cancelled',
  ],
  transitions: [
    { from: 'draft',            to: 'submitted',        action: 'submit' },
    { from: 'draft',            to: 'cancelled',        action: 'cancel' },
    { from: 'submitted',        to: 'approved',         action: 'approve' },
    { from: 'submitted',        to: 'revise_requested', action: 'revise' },
    { from: 'submitted',        to: 'cancelled',        action: 'cancel' },
    { from: 'revise_requested', to: 'draft',            action: 'revise_to_draft' },
    { from: 'revise_requested', to: 'submitted',        action: 'resubmit' },
    { from: 'revise_requested', to: 'cancelled',        action: 'cancel' },
    { from: 'approved',         to: 'project_pending',  action: 'convert_to_project' },
    { from: 'approved',         to: 'cancelled',        action: 'cancel' },
  ],
};

// Alias matching the build spec naming.
export const quoteStateMachine = QUOTE_FSM;

// ---------------------------------------------------------------------------
// project machine: pending -> ready_to_build -> in_production ->
// ready_to_ship -> completed. cancelled is a sink reachable from any
// non-terminal state.
// ---------------------------------------------------------------------------

export type ProjectState =
  | 'pending'
  | 'ready_to_build'
  | 'in_production'
  | 'ready_to_ship'
  | 'completed'
  | 'cancelled';

export const PROJECT_FSM: Fsm<ProjectState> = {
  entity: 'project',
  initial: 'pending',
  states: [
    'pending', 'ready_to_build', 'in_production',
    'ready_to_ship', 'completed', 'cancelled',
  ],
  transitions: [
    { from: 'pending',        to: 'ready_to_build', action: 'mark_ready_to_build' },
    { from: 'pending',        to: 'cancelled',      action: 'cancel' },
    { from: 'ready_to_build', to: 'in_production',  action: 'start_production' },
    { from: 'ready_to_build', to: 'cancelled',      action: 'cancel' },
    { from: 'in_production',  to: 'ready_to_ship',  action: 'mark_ready_to_ship' },
    { from: 'in_production',  to: 'cancelled',      action: 'cancel' },
    { from: 'ready_to_ship',  to: 'completed',      action: 'complete' },
    { from: 'ready_to_ship',  to: 'cancelled',      action: 'cancel' },
  ],
};

export const projectStateMachine = PROJECT_FSM;

// ---------------------------------------------------------------------------
// project_phase machine: pending -> active -> completed. cancelled is a sink.
// ---------------------------------------------------------------------------

export type ProjectPhaseState =
  | 'pending'
  | 'active'
  | 'completed'
  | 'cancelled';

export const PROJECT_PHASE_FSM: Fsm<ProjectPhaseState> = {
  entity: 'project_phase',
  initial: 'pending',
  states: ['pending', 'active', 'completed', 'cancelled'],
  transitions: [
    { from: 'pending', to: 'active',    action: 'start' },
    { from: 'pending', to: 'cancelled', action: 'cancel' },
    { from: 'active',  to: 'completed', action: 'complete' },
    { from: 'active',  to: 'cancelled', action: 'cancel' },
  ],
};

export const projectPhaseStateMachine = PROJECT_PHASE_FSM;

export function canTransition<S extends string>(
  fsm: Fsm<S>,
  from: S,
  to: S,
): boolean {
  return fsm.transitions.some((t) => t.from === from && t.to === to);
}

export const SALES_FSMS = {
  quote: QUOTE_FSM,
  project: PROJECT_FSM,
  project_phase: PROJECT_PHASE_FSM,
} as const;
