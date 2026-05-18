// CRM workflow canon. Byte-mirror of apps/web/src/lib/workflow/crm.ts.
// Lead state machine: 5 states. Opportunity stage machine: 6 stages.
// The DB CHECK constraint and audit trigger are authority; the SPA hides
// invalid buttons via canCrmTransition().

export type CrmFsmTransition<S extends string> = {
  from: S;
  to: S;
  action: string;
};

export type CrmFsm<S extends string> = {
  entity: string;
  initial: S;
  states: readonly S[];
  transitions: readonly CrmFsmTransition<S>[];
};

export type LeadState =
  | 'new'
  | 'working'
  | 'qualified'
  | 'converted'
  | 'disqualified';

export const leadStateMachine: CrmFsm<LeadState> = {
  entity: 'lead',
  initial: 'new',
  states: ['new', 'working', 'qualified', 'converted', 'disqualified'],
  transitions: [
    { from: 'new',          to: 'working',      action: 'start_work' },
    { from: 'new',          to: 'disqualified', action: 'disqualify' },
    { from: 'working',      to: 'qualified',    action: 'qualify' },
    { from: 'working',      to: 'disqualified', action: 'disqualify' },
    { from: 'qualified',    to: 'converted',    action: 'convert' },
    { from: 'qualified',    to: 'disqualified', action: 'disqualify' },
    { from: 'disqualified', to: 'working',      action: 'reopen' },
  ],
};

export type OpportunityStageState =
  | 'discovery'
  | 'evaluation'
  | 'proposal'
  | 'negotiation'
  | 'closed_won'
  | 'closed_lost';

export const opportunityStageMachine: CrmFsm<OpportunityStageState> = {
  entity: 'opportunity',
  initial: 'discovery',
  states: [
    'discovery',
    'evaluation',
    'proposal',
    'negotiation',
    'closed_won',
    'closed_lost',
  ],
  transitions: [
    { from: 'discovery',   to: 'evaluation',  action: 'advance' },
    { from: 'discovery',   to: 'closed_lost', action: 'lose' },
    { from: 'evaluation',  to: 'proposal',    action: 'advance' },
    { from: 'evaluation',  to: 'discovery',   action: 'rewind' },
    { from: 'evaluation',  to: 'closed_lost', action: 'lose' },
    { from: 'proposal',    to: 'negotiation', action: 'advance' },
    { from: 'proposal',    to: 'evaluation',  action: 'rewind' },
    { from: 'proposal',    to: 'closed_lost', action: 'lose' },
    { from: 'negotiation', to: 'closed_won',  action: 'win' },
    { from: 'negotiation', to: 'closed_lost', action: 'lose' },
    { from: 'negotiation', to: 'proposal',    action: 'rewind' },
  ],
};

export function canCrmTransition<S extends string>(
  fsm: CrmFsm<S>,
  from: S,
  to: S,
): boolean {
  return fsm.transitions.some((t) => t.from === from && t.to === to);
}

export const CRM_FSMS = {
  lead: leadStateMachine,
  opportunity: opportunityStageMachine,
} as const;
