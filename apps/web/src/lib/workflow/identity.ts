// Identity / tenancy state machines.
// BYTE-IDENTICAL with apps/web/src/lib/workflow/identity.ts. Asserted by
// the contract test at wave close.
//
// The DB owns the authoritative organizations.status CHECK constraint
// ('provisioning', 'active', 'suspended', 'archived') from migration 0002.
// The audit trigger writes one row per transition. The SPA reads this
// machine to hide buttons that would produce illegal transitions; the
// server is authority and rejects them via the CHECK plus capability gate.

export type OrganizationStatus =
  | 'provisioning'
  | 'active'
  | 'suspended'
  | 'archived';

export interface FsmTransition<S extends string> {
  from: S;
  to: S;
  action: string;
  capability: string;
}

export interface Fsm<S extends string> {
  entity: string;
  initial: S;
  states: ReadonlyArray<S>;
  transitions: ReadonlyArray<FsmTransition<S>>;
}

export const ORGANIZATION_STATE_MACHINE: Fsm<OrganizationStatus> = {
  entity: 'organization',
  initial: 'provisioning',
  states: ['provisioning', 'active', 'suspended', 'archived'],
  transitions: [
    { from: 'provisioning', to: 'active',    action: 'activate',  capability: 'tenancy.org.update' },
    { from: 'active',       to: 'suspended', action: 'suspend',   capability: 'tenancy.org.update' },
    { from: 'suspended',    to: 'active',    action: 'reinstate', capability: 'tenancy.org.update' },
    { from: 'active',       to: 'archived',  action: 'archive',   capability: 'tenancy.org.update' },
    { from: 'suspended',    to: 'archived',  action: 'archive',   capability: 'tenancy.org.update' },
  ],
};

export function canTransitionOrganization(
  from: OrganizationStatus,
  to: OrganizationStatus,
): boolean {
  return ORGANIZATION_STATE_MACHINE.transitions.some(
    (t) => t.from === from && t.to === to,
  );
}

export const IDENTITY_FSMS = {
  organization: ORGANIZATION_STATE_MACHINE,
} as const;
