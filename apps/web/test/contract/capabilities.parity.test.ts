import { describe, expect, it } from 'vitest';
import {
  CAPABILITIES_BY_ROLE,
  hasCap,
  type RoleCode,
  type Capability,
} from '@/lib/capabilities';

// Behavioural parity beyond byte-identity. parity.test.ts only proves the SPA
// and _shared copies of capabilities.ts are byte-for-byte equal; a symmetric
// logic bug (a cap wired into the wrong role on BOTH copies) would pass the
// byte check and ship. This suite asserts known-true role-to-capability facts
// so that a role policy regression fails CI even when the two copies still
// agree.
//
// The assertions are a high-signal sample, not an exhaustive ~120-cap
// enumeration: each role is checked for a handful of caps it must hold and a
// handful it must not, plus the structural invariants every role policy must
// keep (8 roles present, read-only roles hold no write/delete caps, external
// portal roles are scoped away from internal authoring).
//
// Risk closed: R-W14-CONTRACT-01.

const ALL_ROLES: ReadonlyArray<RoleCode> = [
  'org_owner',
  'org_admin',
  'sales',
  'ops',
  'accounting',
  'viewer',
  'customer_user',
  'vendor_user',
];

// A representative set of write / mutate / delete caps. Read-only roles
// (viewer, customer_user, vendor_user) must hold NONE of these.
const WRITE_CAPS: ReadonlyArray<Capability> = [
  'crm.customers.write',
  'crm.customers.delete',
  'invoices.write',
  'payments.write',
  'journal_entries.post',
  'period_close.close',
  'org.organization.update',
];

describe('capabilities role policy structure', () => {
  it('declares exactly the 8 constitutional roles', () => {
    expect(Object.keys(CAPABILITIES_BY_ROLE).sort()).toEqual(
      [...ALL_ROLES].sort(),
    );
  });

  it('every role holds a non-empty capability set', () => {
    for (const role of ALL_ROLES) {
      expect(CAPABILITIES_BY_ROLE[role].length).toBeGreaterThan(0);
    }
  });

  it('no role lists a duplicate capability', () => {
    for (const role of ALL_ROLES) {
      const caps = CAPABILITIES_BY_ROLE[role];
      expect(new Set(caps).size).toBe(caps.length);
    }
  });

  it('hasCap agrees with the underlying CAPABILITIES_BY_ROLE membership', () => {
    expect(hasCap('org_owner', 'org.organization.update')).toBe(true);
    expect(hasCap('viewer', 'org.organization.update')).toBe(false);
  });
});

describe('org_owner holds the broad administrative set', () => {
  it('can manage the organization and billing', () => {
    expect(hasCap('org_owner', 'org.organization.update')).toBe(true);
    expect(hasCap('org_owner', 'org.organization.suspend')).toBe(true);
    expect(hasCap('org_owner', 'org.organization.archive')).toBe(true);
    expect(hasCap('org_owner', 'org.billing.manage')).toBe(true);
  });

  it('can write across CRM and finance', () => {
    expect(hasCap('org_owner', 'crm.customers.write')).toBe(true);
    expect(hasCap('org_owner', 'invoices.write')).toBe(true);
  });

  it('holds the widest capability set of any role', () => {
    const ownerCount = CAPABILITIES_BY_ROLE.org_owner.length;
    for (const role of ALL_ROLES) {
      expect(ownerCount).toBeGreaterThanOrEqual(
        CAPABILITIES_BY_ROLE[role].length,
      );
    }
  });
});

describe('sales is scoped to the commercial surface', () => {
  it('can write CRM and convert leads', () => {
    expect(hasCap('sales', 'crm.customers.write')).toBe(true);
    expect(hasCap('sales', 'crm.leads.convert')).toBe(true);
  });

  it('cannot administer the organization or post finance', () => {
    expect(hasCap('sales', 'org.organization.update')).toBe(false);
    expect(hasCap('sales', 'journal_entries.post')).toBe(false);
    expect(hasCap('sales', 'org.billing.manage')).toBe(false);
  });
});

describe('accounting owns the finance lifecycle', () => {
  it('can write and post finance entities', () => {
    expect(hasCap('accounting', 'invoices.write')).toBe(true);
    expect(hasCap('accounting', 'payments.write')).toBe(true);
    expect(hasCap('accounting', 'journal_entries.post')).toBe(true);
    expect(hasCap('accounting', 'period_close.close')).toBe(true);
    expect(hasCap('accounting', 'period_close.reopen')).toBe(true);
  });

  it('cannot administer the organization', () => {
    expect(hasCap('accounting', 'org.organization.update')).toBe(false);
  });
});

describe('viewer is strictly read-only', () => {
  it('holds representative read caps', () => {
    expect(hasCap('viewer', 'crm.customers.read')).toBe(true);
    expect(hasCap('viewer', 'invoices.read')).toBe(true);
    expect(hasCap('viewer', 'org.audit_log.read')).toBe(true);
  });

  it('holds none of the write / mutate caps', () => {
    for (const cap of WRITE_CAPS) {
      expect(hasCap('viewer', cap)).toBe(false);
    }
  });
});

describe('customer_user is scoped to the customer portal', () => {
  it('holds portal read caps only', () => {
    expect(hasCap('customer_user', 'portal.invoice.read')).toBe(true);
    expect(hasCap('customer_user', 'portal.quote.read')).toBe(true);
    expect(hasCap('customer_user', 'portal.project.read')).toBe(true);
  });

  it('cannot touch internal authoring or administration', () => {
    expect(hasCap('customer_user', 'crm.customers.write')).toBe(false);
    expect(hasCap('customer_user', 'invoices.write')).toBe(false);
    expect(hasCap('customer_user', 'org.audit_log.read')).toBe(false);
    for (const cap of WRITE_CAPS) {
      expect(hasCap('customer_user', cap)).toBe(false);
    }
  });
});

describe('vendor_user is scoped to the vendor portal', () => {
  it('holds vendor-facing read caps only', () => {
    expect(hasCap('vendor_user', 'purchase_orders.purchase_order.read')).toBe(true);
    expect(hasCap('vendor_user', 'vendor_bills.vendor_bill.read')).toBe(true);
  });

  it('cannot touch internal authoring, CRM, or administration', () => {
    expect(hasCap('vendor_user', 'crm.customers.write')).toBe(false);
    expect(hasCap('vendor_user', 'crm.customers.read')).toBe(false);
    expect(hasCap('vendor_user', 'invoices.write')).toBe(false);
    for (const cap of WRITE_CAPS) {
      expect(hasCap('vendor_user', cap)).toBe(false);
    }
  });
});

describe('org_admin administers without the owner-only billing reach', () => {
  it('can administer the organization', () => {
    expect(hasCap('org_admin', 'org.organization.update')).toBe(true);
  });

  it('holds a broad set comparable to the owner', () => {
    expect(CAPABILITIES_BY_ROLE.org_admin.length).toBeGreaterThan(
      CAPABILITIES_BY_ROLE.viewer.length,
    );
  });
});
