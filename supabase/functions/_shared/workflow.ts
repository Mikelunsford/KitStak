// Workflow canon. Byte-mirror of supabase/functions/_shared/workflow.ts.
// Every state machine in Kitstak declares its allowed transitions here. The
// SPA hides invalid buttons; the server is authority and rejects illegal
// transitions through CHECK constraints and the audit trigger.

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

export type OrganizationStatus =
  | 'provisioning'
  | 'active'
  | 'suspended'
  | 'archived';

export const ORGANIZATION_FSM: Fsm<OrganizationStatus> = {
  entity: 'organization',
  initial: 'provisioning',
  states: ['provisioning', 'active', 'suspended', 'archived'],
  transitions: [
    { from: 'provisioning', to: 'active',     action: 'activate' },
    { from: 'active',       to: 'suspended',  action: 'suspend' },
    { from: 'suspended',    to: 'active',     action: 'reinstate' },
    { from: 'active',       to: 'archived',   action: 'archive' },
    { from: 'suspended',    to: 'archived',   action: 'archive' },
  ],
};

export function canTransition<S extends string>(
  fsm: Fsm<S>,
  from: S,
  to: S,
): boolean {
  return fsm.transitions.some((t) => t.from === from && t.to === to);
}

export const FSMS = {
  organization: ORGANIZATION_FSM,
} as const;
