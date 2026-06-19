// Regression suite for ORGANIZATION_FSM in the workflow canon.
//
// The organization state machine lives in the byte-mirrored workflow canon
// (apps/web/src/lib/workflow.ts == supabase/functions/_shared/workflow.ts) and
// is the single source of truth the SPA consults via canTransition() to hide
// invalid buttons. A richer identity side-car (apps/web/src/lib/workflow/
// identity.ts) carries the same five transitions with capability annotations;
// this suite pins the singular canon copy.
//
// The DB owns the authoritative organizations.status CHECK constraint
// ('provisioning', 'active', 'suspended', 'archived') from migration 0002 and
// the audit trigger writes one row per transition. This test is the guard that
// the canon cannot silently drift from that constraint: it pins the four states
// and the exact allowed-transition set so that adding, removing, or re-routing
// a transition fails CI. It imports the real module; it never hardcodes a copy.
//
// Risk closed: R-W14-TEST-04.
// Constitutional invariant protected: the organization FSM transitions are
// frozen here. A change to them is a deliberate, reviewed canon edit.

import { describe, it, expect } from 'vitest';

import {
  ORGANIZATION_FSM,
  canTransition,
  FSMS,
  type OrganizationStatus,
} from '../../src/lib/workflow';

// The full state set, used to derive the illegal transitions exhaustively.
const ALL_STATES: ReadonlyArray<OrganizationStatus> = [
  'provisioning',
  'active',
  'suspended',
  'archived',
];

// The authoritative allowed-set, mirroring migration 0002 and the canon.
const ALLOWED: Record<OrganizationStatus, ReadonlyArray<OrganizationStatus>> = {
  provisioning: ['active'],
  active: ['suspended', 'archived'],
  suspended: ['active', 'archived'],
  archived: [],
};

describe('ORGANIZATION_FSM shape', () => {
  it('declares the organization entity and provisioning initial state', () => {
    expect(ORGANIZATION_FSM.entity).toBe('organization');
    expect(ORGANIZATION_FSM.initial).toBe('provisioning');
  });

  it('declares exactly the four canonical states', () => {
    expect([...ORGANIZATION_FSM.states]).toEqual([
      'provisioning',
      'active',
      'suspended',
      'archived',
    ]);
  });

  it('declares exactly the five canonical transitions', () => {
    expect(ORGANIZATION_FSM.transitions).toHaveLength(5);
  });

  it('is registered in the workflow canon under the organization key', () => {
    expect(FSMS.organization).toBe(ORGANIZATION_FSM);
  });
});

describe('ORGANIZATION_FSM legal transitions return true', () => {
  it('provisioning -> active (activate)', () => {
    expect(canTransition(ORGANIZATION_FSM, 'provisioning', 'active')).toBe(true);
  });

  it('active -> suspended (suspend)', () => {
    expect(canTransition(ORGANIZATION_FSM, 'active', 'suspended')).toBe(true);
  });

  it('suspended -> active (reinstate)', () => {
    expect(canTransition(ORGANIZATION_FSM, 'suspended', 'active')).toBe(true);
  });

  it('active -> archived (archive)', () => {
    expect(canTransition(ORGANIZATION_FSM, 'active', 'archived')).toBe(true);
  });

  it('suspended -> archived (archive)', () => {
    expect(canTransition(ORGANIZATION_FSM, 'suspended', 'archived')).toBe(true);
  });
});

describe('ORGANIZATION_FSM illegal transitions return false', () => {
  it('provisioning -> suspended (must activate first)', () => {
    expect(canTransition(ORGANIZATION_FSM, 'provisioning', 'suspended')).toBe(false);
  });

  it('provisioning -> archived (must activate first)', () => {
    expect(canTransition(ORGANIZATION_FSM, 'provisioning', 'archived')).toBe(false);
  });

  it('active -> provisioning (no rewind to provisioning)', () => {
    expect(canTransition(ORGANIZATION_FSM, 'active', 'provisioning')).toBe(false);
  });

  it('archived -> active (archived is terminal)', () => {
    expect(canTransition(ORGANIZATION_FSM, 'archived', 'active')).toBe(false);
  });

  it('archived -> anything (archived is terminal)', () => {
    for (const to of ALL_STATES) {
      expect(canTransition(ORGANIZATION_FSM, 'archived', to)).toBe(false);
    }
  });

  it('active -> active (no self-loop)', () => {
    expect(canTransition(ORGANIZATION_FSM, 'active', 'active')).toBe(false);
  });
});

describe('ORGANIZATION_FSM allowed-set matches the canon exactly', () => {
  // For every (from, to) pair, canTransition must agree with ALLOWED. This is
  // the exhaustive drift guard: any extra or missing transition fails here.
  for (const from of ALL_STATES) {
    it(`from=${from} allows exactly [${ALLOWED[from].join(', ')}]`, () => {
      const actual = ALL_STATES.filter((to) =>
        canTransition(ORGANIZATION_FSM, from, to),
      );
      expect(actual).toEqual([...ALLOWED[from]]);
    });
  }
});
