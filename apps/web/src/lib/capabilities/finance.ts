// Finance capability canon. Byte-mirror of apps/web/src/lib/capabilities/finance.ts.
// Shape: <domain>.<resource>.<action>. The server is authority via requireCap();
// the SPA uses FINANCE_CAPABILITY_POLICY only to hide buttons. The eight roles
// from the foundation are the policy domain; customer_user and vendor_user
// receive no internal finance caps.

export type FinanceRoleCode =
  | 'org_owner'
  | 'org_admin'
  | 'sales'
  | 'ops'
  | 'accounting'
  | 'viewer'
  | 'customer_user'
  | 'vendor_user';

export const FINANCE_CAPABILITIES = [
  'invoices.read',
  'invoices.write',
  'invoices.delete',
  'invoices.send',
  'invoices.cancel',
  'invoices.transition',
  'payments.read',
  'payments.write',
  'payments.delete',
  'payments.apply',
  'credit_notes.read',
  'credit_notes.write',
  'credit_notes.delete',
  'credit_notes.apply',
  'coa.read',
  'coa.write',
  'coa.delete',
  'journal_entries.read',
  'journal_entries.write',
  'journal_entries.delete',
  'journal_entries.post',
  'period_close.read',
  'period_close.close',
  'period_close.reopen',
] as const;

export type FinanceCapability = (typeof FINANCE_CAPABILITIES)[number];

const OWNER_AND_ADMIN: ReadonlyArray<FinanceCapability> = [
  'invoices.read',
  'invoices.write',
  'invoices.delete',
  'invoices.send',
  'invoices.cancel',
  'invoices.transition',
  'payments.read',
  'payments.write',
  'payments.delete',
  'payments.apply',
  'credit_notes.read',
  'credit_notes.write',
  'credit_notes.delete',
  'credit_notes.apply',
  'coa.read',
  'coa.write',
  'coa.delete',
  'journal_entries.read',
  'journal_entries.write',
  'journal_entries.delete',
  'journal_entries.post',
  'period_close.read',
  'period_close.close',
  'period_close.reopen',
];

const ACCOUNTING: ReadonlyArray<FinanceCapability> = [
  'invoices.read',
  'invoices.write',
  'invoices.send',
  'invoices.cancel',
  'invoices.transition',
  'payments.read',
  'payments.write',
  'payments.apply',
  'credit_notes.read',
  'credit_notes.write',
  'credit_notes.apply',
  'coa.read',
  'coa.write',
  'journal_entries.read',
  'journal_entries.write',
  'journal_entries.post',
  'period_close.read',
  'period_close.close',
  'period_close.reopen',
];

const SALES: ReadonlyArray<FinanceCapability> = [
  'invoices.read',
  'invoices.write',
  'invoices.send',
  'payments.read',
  'credit_notes.read',
  'coa.read',
  'journal_entries.read',
  'period_close.read',
];

const OPS: ReadonlyArray<FinanceCapability> = [
  'invoices.read',
  'payments.read',
  'credit_notes.read',
];

const VIEWER: ReadonlyArray<FinanceCapability> = [
  'invoices.read',
  'payments.read',
  'credit_notes.read',
  'coa.read',
  'journal_entries.read',
  'period_close.read',
];

const EXTERNAL: ReadonlyArray<FinanceCapability> = [];

export const FINANCE_CAPABILITY_POLICY: Readonly<
  Record<FinanceRoleCode, ReadonlyArray<FinanceCapability>>
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

export function hasFinanceCap(
  role: FinanceRoleCode,
  cap: FinanceCapability,
): boolean {
  return FINANCE_CAPABILITY_POLICY[role].includes(cap);
}
