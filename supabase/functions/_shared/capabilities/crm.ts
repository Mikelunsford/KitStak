// CRM capability canon. Byte-mirror of apps/web/src/lib/capabilities/crm.ts.
// Shape: crm.<resource>.<action>. The server is authority via requireCap();
// the SPA uses CRM_CAPABILITY_POLICY only to hide buttons. The eight roles
// from the foundation are the policy domain; customer_user and vendor_user
// receive no internal CRM caps.

export type CrmRoleCode =
  | 'org_owner'
  | 'org_admin'
  | 'sales'
  | 'ops'
  | 'accounting'
  | 'viewer'
  | 'customer_user'
  | 'vendor_user';

export const CRM_CAPABILITIES = [
  'crm.customers.read',
  'crm.customers.write',
  'crm.customers.delete',
  'crm.contacts.read',
  'crm.contacts.write',
  'crm.contacts.delete',
  'crm.activities.read',
  'crm.activities.write',
  'crm.activities.delete',
  'crm.leads.read',
  'crm.leads.write',
  'crm.leads.delete',
  'crm.leads.convert',
  'crm.opportunities.read',
  'crm.opportunities.write',
  'crm.opportunities.delete',
  'crm.opportunities.stage.transition',
] as const;

export type CrmCapability = (typeof CRM_CAPABILITIES)[number];

const OWNER_AND_ADMIN: ReadonlyArray<CrmCapability> = [
  'crm.customers.read',
  'crm.customers.write',
  'crm.customers.delete',
  'crm.contacts.read',
  'crm.contacts.write',
  'crm.contacts.delete',
  'crm.activities.read',
  'crm.activities.write',
  'crm.activities.delete',
  'crm.leads.read',
  'crm.leads.write',
  'crm.leads.delete',
  'crm.leads.convert',
  'crm.opportunities.read',
  'crm.opportunities.write',
  'crm.opportunities.delete',
  'crm.opportunities.stage.transition',
];

const SALES: ReadonlyArray<CrmCapability> = [
  'crm.customers.read',
  'crm.customers.write',
  'crm.contacts.read',
  'crm.contacts.write',
  'crm.contacts.delete',
  'crm.activities.read',
  'crm.activities.write',
  'crm.activities.delete',
  'crm.leads.read',
  'crm.leads.write',
  'crm.leads.delete',
  'crm.leads.convert',
  'crm.opportunities.read',
  'crm.opportunities.write',
  'crm.opportunities.stage.transition',
];

const OPS: ReadonlyArray<CrmCapability> = [
  'crm.customers.read',
  'crm.contacts.read',
  'crm.activities.read',
  'crm.activities.write',
  'crm.leads.read',
  'crm.opportunities.read',
];

const ACCOUNTING: ReadonlyArray<CrmCapability> = [
  'crm.customers.read',
  'crm.contacts.read',
  'crm.activities.read',
  'crm.leads.read',
  'crm.opportunities.read',
];

const VIEWER: ReadonlyArray<CrmCapability> = [
  'crm.customers.read',
  'crm.contacts.read',
  'crm.activities.read',
  'crm.leads.read',
  'crm.opportunities.read',
];

const EXTERNAL: ReadonlyArray<CrmCapability> = [];

export const CRM_CAPABILITY_POLICY: Readonly<
  Record<CrmRoleCode, ReadonlyArray<CrmCapability>>
> = {
  org_owner:     OWNER_AND_ADMIN,
  org_admin:     OWNER_AND_ADMIN,
  sales:         SALES,
  ops:           OPS,
  accounting:    ACCOUNTING,
  viewer:        VIEWER,
  customer_user: EXTERNAL,
  vendor_user:   EXTERNAL,
};

export function hasCrmCap(role: CrmRoleCode, cap: CrmCapability): boolean {
  return CRM_CAPABILITY_POLICY[role].includes(cap);
}
