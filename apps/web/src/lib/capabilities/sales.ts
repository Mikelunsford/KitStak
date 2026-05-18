// Sales-domain capabilities. Byte-mirror of apps/web/src/lib/capabilities/sales.ts.
// Shape: <domain>.<resource>.<action>. Server is authority via requireCap();
// SPA mirrors this map for button hiding only.

export type SalesRoleCode =
  | 'org_owner'
  | 'org_admin'
  | 'sales'
  | 'ops'
  | 'accounting'
  | 'viewer'
  | 'customer_user'
  | 'vendor_user';

export const SALES_CAPABILITIES = [
  'items.item.read',
  'items.item.write',
  'items.item.delete',
  'items.category.read',
  'items.category.write',
  'items.unit.read',
  'items.unit.write',

  'taxes.tax.read',
  'taxes.tax.write',
  'taxes.tax.set_default',

  'currencies.currency.read',
  'currencies.exchange_rate.read',
  'currencies.exchange_rate.write',

  'payment_methods.method.read',
  'payment_methods.method.write',
  'payment_methods.method.set_default',

  'pricing_tiers.tier.read',
  'pricing_tiers.tier.write',
  'pricing_tiers.override.read',
  'pricing_tiers.override.write',

  'vas.service.read',
  'vas.service.write',
  'jobs.job_type.read',
  'jobs.job_type.write',

  'quotes.quote.read',
  'quotes.quote.write',
  'quotes.quote.delete',
  'quotes.quote.submit',
  'quotes.quote.approve',
  'quotes.quote.revise',
  'quotes.quote.cancel',
  'quotes.send',
  'quotes.accept',
  'quotes.convert_to_project',
  'quotes.template.read',
  'quotes.template.write',
  'quotes.approval.read',
  'quotes.approval.write',
  'quotes.version.read',
  'quotes.pdf.read',

  'projects.project.read',
  'projects.project.write',
  'projects.project.delete',
  'projects.transition',
  'projects.phase.read',
  'projects.phase.write',
  'projects.phase.transition',
  'projects.phase.reorder',
  'projects.line_item.create',
  'projects.line_item.read',
  'projects.line_item.update',
  'projects.line_item.delete',
  'projects.convert_to_invoice',
] as const;

export type SalesCapability = (typeof SALES_CAPABILITIES)[number];

// ---------------------------------------------------------------------------
// Role policy. Owner / admin get everything. Sales runs the quote-to-project
// motion. Accounting can touch taxes, payment methods, pricing.
// Ops can read items and run projects (post-conversion).
// ---------------------------------------------------------------------------

const OWNER_AND_ADMIN: ReadonlyArray<SalesCapability> = SALES_CAPABILITIES;

const SALES_ROLE_CAPS: ReadonlyArray<SalesCapability> = [
  'items.item.read', 'items.item.write',
  'items.category.read', 'items.category.write',
  'items.unit.read', 'items.unit.write',
  'taxes.tax.read',
  'currencies.currency.read', 'currencies.exchange_rate.read',
  'payment_methods.method.read',
  'pricing_tiers.tier.read', 'pricing_tiers.override.read',
  'pricing_tiers.override.write',
  'vas.service.read', 'vas.service.write',
  'jobs.job_type.read',
  'quotes.quote.read', 'quotes.quote.write',
  'quotes.quote.submit', 'quotes.quote.revise', 'quotes.quote.cancel',
  'quotes.send', 'quotes.accept', 'quotes.convert_to_project',
  'quotes.template.read', 'quotes.template.write',
  'quotes.approval.read', 'quotes.version.read', 'quotes.pdf.read',
  'projects.project.read', 'projects.project.write',
  'projects.transition',
  'projects.phase.read', 'projects.phase.write',
  'projects.phase.transition', 'projects.phase.reorder',
  'projects.line_item.create', 'projects.line_item.read',
  'projects.line_item.update', 'projects.line_item.delete',
  'projects.convert_to_invoice',
];

const OPS_CAPS: ReadonlyArray<SalesCapability> = [
  'items.item.read', 'items.category.read', 'items.unit.read',
  'currencies.currency.read',
  'vas.service.read', 'jobs.job_type.read',
  'quotes.quote.read', 'quotes.version.read', 'quotes.pdf.read',
  'projects.project.read', 'projects.project.write',
  'projects.transition',
  'projects.phase.read', 'projects.phase.write',
  'projects.phase.transition', 'projects.phase.reorder',
  'projects.line_item.read', 'projects.line_item.update',
];

const ACCOUNTING_CAPS: ReadonlyArray<SalesCapability> = [
  'items.item.read', 'items.category.read', 'items.unit.read',
  'taxes.tax.read', 'taxes.tax.write', 'taxes.tax.set_default',
  'currencies.currency.read',
  'currencies.exchange_rate.read', 'currencies.exchange_rate.write',
  'payment_methods.method.read', 'payment_methods.method.write',
  'payment_methods.method.set_default',
  'pricing_tiers.tier.read', 'pricing_tiers.tier.write',
  'pricing_tiers.override.read', 'pricing_tiers.override.write',
  'vas.service.read', 'jobs.job_type.read',
  'quotes.quote.read', 'quotes.quote.write',
  'quotes.quote.approve', 'quotes.quote.cancel',
  'quotes.send', 'quotes.accept', 'quotes.convert_to_project',
  'quotes.template.read', 'quotes.template.write',
  'quotes.approval.read', 'quotes.approval.write',
  'quotes.version.read', 'quotes.pdf.read',
  'projects.project.read', 'projects.transition',
  'projects.phase.read', 'projects.phase.transition',
  'projects.line_item.read',
  'projects.convert_to_invoice',
];

const VIEWER_CAPS: ReadonlyArray<SalesCapability> = [
  'items.item.read', 'items.category.read', 'items.unit.read',
  'taxes.tax.read', 'currencies.currency.read',
  'currencies.exchange_rate.read', 'payment_methods.method.read',
  'pricing_tiers.tier.read', 'pricing_tiers.override.read',
  'vas.service.read', 'jobs.job_type.read',
  'quotes.quote.read', 'quotes.version.read', 'quotes.pdf.read',
  'quotes.template.read', 'quotes.approval.read',
  'projects.project.read', 'projects.phase.read',
  'projects.line_item.read',
];

const EXTERNAL_CAPS: ReadonlyArray<SalesCapability> = [
  'quotes.quote.read', 'quotes.pdf.read',
  'projects.project.read', 'projects.phase.read',
];

export const SALES_CAPABILITIES_BY_ROLE: Readonly<
  Record<SalesRoleCode, ReadonlyArray<SalesCapability>>
> = {
  org_owner:     OWNER_AND_ADMIN,
  org_admin:     OWNER_AND_ADMIN,
  sales:         SALES_ROLE_CAPS,
  ops:           OPS_CAPS,
  accounting:    ACCOUNTING_CAPS,
  viewer:        VIEWER_CAPS,
  customer_user: EXTERNAL_CAPS,
  vendor_user:   [],
};

export function hasSalesCap(
  role: SalesRoleCode,
  cap: SalesCapability,
): boolean {
  return SALES_CAPABILITIES_BY_ROLE[role].includes(cap);
}
