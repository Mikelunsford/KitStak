// Pin the workspace-switcher membership filter. F-Wave14-PORTAL-DUALROLE-SWITCH-01.
//
// Pure-TS suite, no React renderer (mirrors sidebarGating.test.ts).

import { describe, it, expect } from 'vitest';

import {
  isStaffRole,
  staffMemberships,
  PORTAL_ROLE_CODES,
} from './workspaceMemberships';

describe('isStaffRole', () => {
  it('treats every operator role as staff', () => {
    const staff = [
      'org_owner',
      'org_admin',
      'sales',
      'ops',
      'accounting',
      'viewer',
    ] as const;
    for (const role of staff) {
      expect(isStaffRole(role)).toBe(true);
    }
  });

  it('treats portal roles as non-staff', () => {
    expect(isStaffRole('customer_user')).toBe(false);
    expect(isStaffRole('vendor_user')).toBe(false);
  });
});

describe('staffMemberships', () => {
  it('drops the portal membership so a dual-role user cannot strand themselves', () => {
    // Arrange: owner in one org, customer_user in another (the exact trap).
    const memberships = [
      { org_id: 'a', display_name: 'Team 1', role: 'org_owner' as const },
      { org_id: 'b', display_name: 'Kitstak', role: 'customer_user' as const },
    ];

    // Act
    const result = staffMemberships(memberships);

    // Assert: only the staff org survives, full row shape preserved.
    expect(result).toEqual([
      { org_id: 'a', display_name: 'Team 1', role: 'org_owner' },
    ]);
  });

  it('returns empty when the user holds only portal memberships', () => {
    const result = staffMemberships([
      { org_id: 'b', display_name: 'Kitstak', role: 'customer_user' as const },
      { org_id: 'c', display_name: 'Acme', role: 'vendor_user' as const },
    ]);
    expect(result).toEqual([]);
  });

  it('keeps every staff membership and preserves order', () => {
    const memberships = [
      { org_id: 'a', role: 'viewer' as const },
      { org_id: 'b', role: 'org_admin' as const },
    ];
    expect(staffMemberships(memberships)).toEqual(memberships);
  });
});

describe('PORTAL_ROLE_CODES', () => {
  it('is exactly the two external role codes', () => {
    expect([...PORTAL_ROLE_CODES].sort()).toEqual([
      'customer_user',
      'vendor_user',
    ]);
  });
});
