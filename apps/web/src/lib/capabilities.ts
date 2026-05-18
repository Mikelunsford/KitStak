// Capability canon. Byte-mirror of supabase/functions/_shared/capabilities.ts.
// Shape: <domain>.<resource>.<action>. The server is authority via
// requireCap(); the SPA uses CAPABILITIES_BY_ROLE only to hide buttons.

export type RoleCode =
  | 'org_owner'
  | 'org_admin'
  | 'sales'
  | 'ops'
  | 'accounting'
  | 'viewer'
  | 'customer_user'
  | 'vendor_user';

export type Capability =
  | 'org.organization.read'
  | 'org.organization.update'
  | 'org.organization.suspend'
  | 'org.organization.archive'
  | 'org.member.read'
  | 'org.member.invite'
  | 'org.member.update'
  | 'org.member.remove'
  | 'org.branding.read'
  | 'org.branding.update'
  | 'org.sso.read'
  | 'org.sso.write'
  | 'org.feature_flag.read'
  | 'org.audit_log.read';

const OWNER_CAPS: ReadonlyArray<Capability> = [
  'org.organization.read',
  'org.organization.update',
  'org.organization.suspend',
  'org.organization.archive',
  'org.member.read',
  'org.member.invite',
  'org.member.update',
  'org.member.remove',
  'org.branding.read',
  'org.branding.update',
  'org.sso.read',
  'org.sso.write',
  'org.feature_flag.read',
  'org.audit_log.read',
];

const ADMIN_CAPS: ReadonlyArray<Capability> = [
  'org.organization.read',
  'org.organization.update',
  'org.member.read',
  'org.member.invite',
  'org.member.update',
  'org.member.remove',
  'org.branding.read',
  'org.branding.update',
  'org.sso.read',
  'org.sso.write',
  'org.feature_flag.read',
  'org.audit_log.read',
];

const READ_ONLY_INTERNAL: ReadonlyArray<Capability> = [
  'org.organization.read',
  'org.member.read',
  'org.branding.read',
  'org.feature_flag.read',
];

const VIEWER_CAPS: ReadonlyArray<Capability> = [
  ...READ_ONLY_INTERNAL,
  'org.audit_log.read',
];

const EXTERNAL_CAPS: ReadonlyArray<Capability> = [
  'org.organization.read',
  'org.branding.read',
];

export const CAPABILITIES_BY_ROLE: Readonly<
  Record<RoleCode, ReadonlyArray<Capability>>
> = {
  org_owner:     OWNER_CAPS,
  org_admin:     ADMIN_CAPS,
  sales:         READ_ONLY_INTERNAL,
  ops:           READ_ONLY_INTERNAL,
  accounting:    READ_ONLY_INTERNAL,
  viewer:        VIEWER_CAPS,
  customer_user: EXTERNAL_CAPS,
  vendor_user:   EXTERNAL_CAPS,
};

export function hasCap(role: RoleCode, cap: Capability): boolean {
  return CAPABILITIES_BY_ROLE[role].includes(cap);
}
