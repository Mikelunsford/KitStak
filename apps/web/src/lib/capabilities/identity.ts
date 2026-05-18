// Identity / tenancy / branding / settings / admin capability matrix.
// BYTE-IDENTICAL with apps/web/src/lib/capabilities/identity.ts. The
// orchestrator composes this with the other agents' matrices into the
// master capabilities.ts canon at wave close.
//
// Shape: <domain>.<resource>.<action> per CLAUDE.md non-negotiables. The
// server is authority via requireCap(); the SPA uses IDENTITY_CAPABILITY_POLICY
// only to hide buttons. A drift between the two surfaces is a release
// blocker; the contract test asserts byte-identity.

export type RoleCode =
  | 'org_owner'
  | 'org_admin'
  | 'sales'
  | 'ops'
  | 'accounting'
  | 'viewer'
  | 'customer_user'
  | 'vendor_user';

export const IDENTITY_CAPABILITIES = [
  // identity.*
  'identity.session.read',
  'identity.session.switch',
  'identity.user.read.self',
  'identity.user.update.self',

  // tenancy.*
  'tenancy.org.read',
  'tenancy.org.update',
  'tenancy.memberships.read',
  'tenancy.memberships.write',
  'tenancy.domains.read',
  'tenancy.domains.write',
  'tenancy.sso.read',
  'tenancy.sso.write',

  // branding.*
  'branding.read',
  'branding.update',
  'branding.logo.upload',

  // settings.*
  'settings.read',
  'settings.write',
  'settings.numbering.read',
  'settings.numbering.reset',

  // flags.*
  'flags.read',
  'flags.write',

  // admin.* (platform-admin surface, gated behind platform_admin.enabled)
  'admin.orgs.read',
  'admin.orgs.impersonate',
  'admin.audit.read',
] as const;

export type IdentityCapability = (typeof IDENTITY_CAPABILITIES)[number];

const OWNER_SET: ReadonlyArray<IdentityCapability> = [
  'identity.session.read',
  'identity.session.switch',
  'identity.user.read.self',
  'identity.user.update.self',
  'tenancy.org.read',
  'tenancy.org.update',
  'tenancy.memberships.read',
  'tenancy.memberships.write',
  'tenancy.domains.read',
  'tenancy.domains.write',
  'tenancy.sso.read',
  'tenancy.sso.write',
  'branding.read',
  'branding.update',
  'branding.logo.upload',
  'settings.read',
  'settings.write',
  'settings.numbering.read',
  'settings.numbering.reset',
  'flags.read',
  'flags.write',
];

const ADMIN_SET: ReadonlyArray<IdentityCapability> = [
  'identity.session.read',
  'identity.session.switch',
  'identity.user.read.self',
  'identity.user.update.self',
  'tenancy.org.read',
  'tenancy.org.update',
  'tenancy.memberships.read',
  'tenancy.memberships.write',
  'tenancy.domains.read',
  'tenancy.domains.write',
  'tenancy.sso.read',
  'tenancy.sso.write',
  'branding.read',
  'branding.update',
  'branding.logo.upload',
  'settings.read',
  'settings.write',
  'settings.numbering.read',
  'settings.numbering.reset',
  'flags.read',
];

const STAFF_READ: ReadonlyArray<IdentityCapability> = [
  'identity.session.read',
  'identity.session.switch',
  'identity.user.read.self',
  'identity.user.update.self',
  'tenancy.org.read',
  'tenancy.memberships.read',
  'tenancy.domains.read',
  'branding.read',
  'settings.read',
  'settings.numbering.read',
  'flags.read',
];

const VIEWER_SET: ReadonlyArray<IdentityCapability> = [
  'identity.session.read',
  'identity.user.read.self',
  'identity.user.update.self',
  'tenancy.org.read',
  'tenancy.memberships.read',
  'branding.read',
  'settings.read',
  'flags.read',
];

const EXTERNAL_SET: ReadonlyArray<IdentityCapability> = [
  'identity.session.read',
  'identity.user.read.self',
  'identity.user.update.self',
  'tenancy.org.read',
  'branding.read',
];

export const IDENTITY_CAPABILITY_POLICY: Readonly<
  Record<RoleCode, ReadonlyArray<IdentityCapability>>
> = {
  org_owner:     OWNER_SET,
  org_admin:     ADMIN_SET,
  sales:         STAFF_READ,
  ops:           STAFF_READ,
  accounting:    STAFF_READ,
  viewer:        VIEWER_SET,
  customer_user: EXTERNAL_SET,
  vendor_user:   EXTERNAL_SET,
};

export function hasIdentityCap(
  role: RoleCode,
  cap: IdentityCapability,
): boolean {
  return IDENTITY_CAPABILITY_POLICY[role].includes(cap);
}
