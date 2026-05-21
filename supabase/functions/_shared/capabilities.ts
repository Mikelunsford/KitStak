// Capability canon. Singular byte-mirror authority for the Kitstak
// constitution: every cap the server gates on lives in this file. Asserted
// byte-identical with apps/web/src/lib/capabilities.ts by parity.test.ts.
//
// History: until Phase 8 (F-Wave2-AGENT-A-05) this surface was split across
// _shared/capabilities/{crm,cross_cutting,finance,identity,sales,
// vendors_inventory_ops}.ts side-cars plus per-bundle requireXxxCap shims
// (D-011). The side-cars carried no cross-domain collisions, so they were
// folded into this singular union. Per-bundle shims are gone; handlers call
// requireCap(caller, cap) from _shared/handler-helpers.ts.
//
// Shape: <domain>.<resource>.<action>. Server is authority via requireCap();
// SPA mirrors CAPABILITIES_BY_ROLE only to hide buttons.

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
  // org.* (14)
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
  | 'org.audit_log.read'
  // crm.* (18)
  | 'crm.customers.read'
  | 'crm.customers.write'
  | 'crm.customers.delete'
  | 'crm.customers.invite_to_portal'
  | 'crm.contacts.read'
  | 'crm.contacts.write'
  | 'crm.contacts.delete'
  | 'crm.activities.read'
  | 'crm.activities.write'
  | 'crm.activities.delete'
  | 'crm.leads.read'
  | 'crm.leads.write'
  | 'crm.leads.delete'
  | 'crm.leads.convert'
  | 'crm.opportunities.read'
  | 'crm.opportunities.write'
  | 'crm.opportunities.delete'
  | 'crm.opportunities.stage.transition'
  // cross_cutting (21)
  | 'audit_log.entry.read'
  | 'attachments.attachment.read'
  | 'attachments.attachment.create'
  | 'attachments.attachment.delete'
  | 'comments.comment.read'
  | 'comments.comment.create'
  | 'comments.comment.delete'
  | 'notifications.notification.read'
  | 'notifications.notification.update'
  | 'search.global.read'
  | 'dashboard.summary.read'
  | 'imports.job.validate'
  | 'imports.job.commit'
  | 'exports.job.create'
  | 'portal.customer.read'
  | 'portal.invoice.read'
  | 'portal.quote.read'
  | 'portal.project.read'
  | 'portal.attachment.read'
  | 'pdf.document.render'
  | 'kitcost.dashboard.view'
  // finance (24)
  | 'invoices.read'
  | 'invoices.write'
  | 'invoices.delete'
  | 'invoices.send'
  | 'invoices.cancel'
  | 'invoices.transition'
  | 'payments.read'
  | 'payments.write'
  | 'payments.delete'
  | 'payments.apply'
  | 'credit_notes.read'
  | 'credit_notes.write'
  | 'credit_notes.delete'
  | 'credit_notes.apply'
  | 'coa.read'
  | 'coa.write'
  | 'coa.delete'
  | 'journal_entries.read'
  | 'journal_entries.write'
  | 'journal_entries.delete'
  | 'journal_entries.post'
  | 'period_close.read'
  | 'period_close.close'
  | 'period_close.reopen'
  // identity (24)
  | 'identity.session.read'
  | 'identity.session.switch'
  | 'identity.user.read.self'
  | 'identity.user.update.self'
  | 'tenancy.org.read'
  | 'tenancy.org.update'
  | 'tenancy.memberships.read'
  | 'tenancy.memberships.write'
  | 'tenancy.domains.read'
  | 'tenancy.domains.write'
  | 'tenancy.sso.read'
  | 'tenancy.sso.write'
  | 'branding.read'
  | 'branding.update'
  | 'branding.logo.upload'
  | 'settings.read'
  | 'settings.write'
  | 'settings.numbering.read'
  | 'settings.numbering.reset'
  | 'flags.read'
  | 'flags.write'
  | 'admin.orgs.read'
  | 'admin.orgs.impersonate'
  | 'admin.audit.read'
  // sales (53)
  | 'items.item.read'
  | 'items.item.write'
  | 'items.item.delete'
  | 'items.category.read'
  | 'items.category.write'
  | 'items.unit.read'
  | 'items.unit.write'
  | 'taxes.tax.read'
  | 'taxes.tax.write'
  | 'taxes.tax.set_default'
  | 'currencies.currency.read'
  | 'currencies.exchange_rate.read'
  | 'currencies.exchange_rate.write'
  | 'payment_methods.method.read'
  | 'payment_methods.method.write'
  | 'payment_methods.method.set_default'
  | 'pricing_tiers.tier.read'
  | 'pricing_tiers.tier.write'
  | 'pricing_tiers.override.read'
  | 'pricing_tiers.override.write'
  | 'vas.service.read'
  | 'vas.service.write'
  | 'jobs.job_type.read'
  | 'jobs.job_type.write'
  | 'quotes.quote.read'
  | 'quotes.quote.write'
  | 'quotes.quote.delete'
  | 'quotes.quote.submit'
  | 'quotes.quote.approve'
  | 'quotes.quote.revise'
  | 'quotes.quote.cancel'
  | 'quotes.send'
  | 'quotes.accept'
  | 'quotes.convert_to_project'
  | 'quotes.template.read'
  | 'quotes.template.write'
  | 'quotes.approval.read'
  | 'quotes.approval.write'
  | 'quotes.version.read'
  | 'quotes.pdf.read'
  | 'projects.project.read'
  | 'projects.project.write'
  | 'projects.project.delete'
  | 'projects.transition'
  | 'projects.phase.read'
  | 'projects.phase.write'
  | 'projects.phase.transition'
  | 'projects.phase.reorder'
  | 'projects.line_item.create'
  | 'projects.line_item.read'
  | 'projects.line_item.update'
  | 'projects.line_item.delete'
  | 'projects.convert_to_invoice'
  // vendors_inventory_ops (60)
  | 'vendors.vendor.read'
  | 'vendors.vendor.create'
  | 'vendors.vendor.update'
  | 'vendors.vendor.delete'
  | 'purchase_orders.purchase_order.read'
  | 'purchase_orders.purchase_order.create'
  | 'purchase_orders.purchase_order.update'
  | 'purchase_orders.purchase_order.transition'
  | 'purchase_orders.line_item.write'
  | 'vendor_bills.vendor_bill.read'
  | 'vendor_bills.vendor_bill.create'
  | 'vendor_bills.vendor_bill.update'
  | 'vendor_bills.vendor_bill.transition'
  | 'vendor_bills.payment.write'
  | 'expenses.expense.read'
  | 'expenses.expense.create'
  | 'expenses.expense.update'
  | 'expenses.expense.submit'
  | 'expenses.expense.approve'
  | 'expenses.expense.pay'
  | 'expenses.expense.reject'
  | 'expenses.category.write'
  | 'warehouses.warehouse.read'
  | 'warehouses.warehouse.create'
  | 'warehouses.warehouse.update'
  | 'warehouses.warehouse.delete'
  | 'stock.level.read'
  | 'stock.movement.read'
  | 'stock.bom.read'
  | 'stock.bom.write'
  | 'receiving.order.read'
  | 'receiving.order.create'
  | 'receiving.order.update'
  | 'receiving.receive'
  | 'receiving.line_item.read'
  | 'receiving.line_item.create'
  | 'receiving.line_item.update'
  | 'receiving.line_item.delete'
  | 'production.run.read'
  | 'production.run.create'
  | 'production.run.update'
  | 'production.start'
  | 'production.complete'
  | 'manufacturing.run.create'
  | 'manufacturing.run.update'
  | 'manufacturing.run.delete'
  | 'manufacturing.run.start'
  | 'manufacturing.run.complete'
  | 'manufacturing.run.cancel'
  | 'manufacturing.run.line_item.create'
  | 'manufacturing.run.line_item.update'
  | 'manufacturing.run.line_item.delete'
  | 'shipments.shipment.read'
  | 'shipments.shipment.create'
  | 'shipments.shipment.update'
  | 'shipments.ship'
  | 'shipment.line_item.read'
  | 'shipment.line_item.create'
  | 'shipment.line_item.update'
  | 'shipment.line_item.delete';

// ---------------------------------------------------------------------------
// Role policy. Each role is the union of caps the prior side-car canons
// granted it. Sourced from:
//   org.*                    _shared/capabilities.ts (pre-merge)
//   crm.*                    _shared/capabilities/crm.ts
//   audit_log/attachments/.. _shared/capabilities/cross_cutting.ts
//   invoices/payments/..     _shared/capabilities/finance.ts
//   identity/tenancy/..      _shared/capabilities/identity.ts
//   items/quotes/projects    _shared/capabilities/sales.ts
//   vendors/stock/receiving  _shared/capabilities/vendors_inventory_ops.ts
// ---------------------------------------------------------------------------

const OWNER_CAPS: ReadonlyArray<Capability> = [
  // org.* (full)
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
  // crm.* (full)
  'crm.customers.read',
  'crm.customers.write',
  'crm.customers.delete',
  'crm.customers.invite_to_portal',
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
  // cross_cutting (INTERNAL_FULL)
  'audit_log.entry.read',
  'attachments.attachment.read',
  'attachments.attachment.create',
  'attachments.attachment.delete',
  'comments.comment.read',
  'comments.comment.create',
  'comments.comment.delete',
  'notifications.notification.read',
  'notifications.notification.update',
  'search.global.read',
  'dashboard.summary.read',
  'imports.job.validate',
  'imports.job.commit',
  'exports.job.create',
  'pdf.document.render',
  'kitcost.dashboard.view',
  // finance (full)
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
  // identity (OWNER_SET)
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
  // sales (full)
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
  // vendors_inventory_ops (full)
  'vendors.vendor.read',
  'vendors.vendor.create',
  'vendors.vendor.update',
  'vendors.vendor.delete',
  'purchase_orders.purchase_order.read',
  'purchase_orders.purchase_order.create',
  'purchase_orders.purchase_order.update',
  'purchase_orders.purchase_order.transition',
  'purchase_orders.line_item.write',
  'vendor_bills.vendor_bill.read',
  'vendor_bills.vendor_bill.create',
  'vendor_bills.vendor_bill.update',
  'vendor_bills.vendor_bill.transition',
  'vendor_bills.payment.write',
  'expenses.expense.read',
  'expenses.expense.create',
  'expenses.expense.update',
  'expenses.expense.submit',
  'expenses.expense.approve',
  'expenses.expense.pay',
  'expenses.expense.reject',
  'expenses.category.write',
  'warehouses.warehouse.read',
  'warehouses.warehouse.create',
  'warehouses.warehouse.update',
  'warehouses.warehouse.delete',
  'stock.level.read',
  'stock.movement.read',
  'stock.bom.read',
  'stock.bom.write',
  'receiving.order.read',
  'receiving.order.create',
  'receiving.order.update',
  'receiving.receive',
  'receiving.line_item.read',
  'receiving.line_item.create',
  'receiving.line_item.update',
  'receiving.line_item.delete',
  'production.run.read',
  'production.run.create',
  'production.run.update',
  'production.start',
  'production.complete',
  'manufacturing.run.create',
  'manufacturing.run.update',
  'manufacturing.run.delete',
  'manufacturing.run.start',
  'manufacturing.run.complete',
  'manufacturing.run.cancel',
  'manufacturing.run.line_item.create',
  'manufacturing.run.line_item.update',
  'manufacturing.run.line_item.delete',
  'shipments.shipment.read',
  'shipments.shipment.create',
  'shipments.shipment.update',
  'shipments.ship',
  'shipment.line_item.read',
  'shipment.line_item.create',
  'shipment.line_item.update',
  'shipment.line_item.delete',
];

const ADMIN_CAPS: ReadonlyArray<Capability> = [
  // org.* (admin set: no suspend/archive)
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
  // crm.* (full)
  'crm.customers.read',
  'crm.customers.write',
  'crm.customers.delete',
  'crm.customers.invite_to_portal',
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
  // cross_cutting (INTERNAL_FULL)
  'audit_log.entry.read',
  'attachments.attachment.read',
  'attachments.attachment.create',
  'attachments.attachment.delete',
  'comments.comment.read',
  'comments.comment.create',
  'comments.comment.delete',
  'notifications.notification.read',
  'notifications.notification.update',
  'search.global.read',
  'dashboard.summary.read',
  'imports.job.validate',
  'imports.job.commit',
  'exports.job.create',
  'pdf.document.render',
  'kitcost.dashboard.view',
  // finance (full)
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
  // identity (ADMIN_SET: no flags.write)
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
  // sales (full)
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
  // vendors_inventory_ops (full)
  'vendors.vendor.read',
  'vendors.vendor.create',
  'vendors.vendor.update',
  'vendors.vendor.delete',
  'purchase_orders.purchase_order.read',
  'purchase_orders.purchase_order.create',
  'purchase_orders.purchase_order.update',
  'purchase_orders.purchase_order.transition',
  'purchase_orders.line_item.write',
  'vendor_bills.vendor_bill.read',
  'vendor_bills.vendor_bill.create',
  'vendor_bills.vendor_bill.update',
  'vendor_bills.vendor_bill.transition',
  'vendor_bills.payment.write',
  'expenses.expense.read',
  'expenses.expense.create',
  'expenses.expense.update',
  'expenses.expense.submit',
  'expenses.expense.approve',
  'expenses.expense.pay',
  'expenses.expense.reject',
  'expenses.category.write',
  'warehouses.warehouse.read',
  'warehouses.warehouse.create',
  'warehouses.warehouse.update',
  'warehouses.warehouse.delete',
  'stock.level.read',
  'stock.movement.read',
  'stock.bom.read',
  'stock.bom.write',
  'receiving.order.read',
  'receiving.order.create',
  'receiving.order.update',
  'receiving.receive',
  'receiving.line_item.read',
  'receiving.line_item.create',
  'receiving.line_item.update',
  'receiving.line_item.delete',
  'production.run.read',
  'production.run.create',
  'production.run.update',
  'production.start',
  'production.complete',
  'manufacturing.run.create',
  'manufacturing.run.update',
  'manufacturing.run.delete',
  'manufacturing.run.start',
  'manufacturing.run.complete',
  'manufacturing.run.cancel',
  'manufacturing.run.line_item.create',
  'manufacturing.run.line_item.update',
  'manufacturing.run.line_item.delete',
  'shipments.shipment.read',
  'shipments.shipment.create',
  'shipments.shipment.update',
  'shipments.ship',
  'shipment.line_item.read',
  'shipment.line_item.create',
  'shipment.line_item.update',
  'shipment.line_item.delete',
];

const SALES_CAPS: ReadonlyArray<Capability> = [
  // org.* (read-only-internal)
  'org.organization.read',
  'org.member.read',
  'org.branding.read',
  'org.feature_flag.read',
  // crm SALES
  'crm.customers.read',
  'crm.customers.write',
  'crm.customers.invite_to_portal',
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
  // cross_cutting INTERNAL_AUTHOR
  'audit_log.entry.read',
  'attachments.attachment.read',
  'attachments.attachment.create',
  'attachments.attachment.delete',
  'comments.comment.read',
  'comments.comment.create',
  'comments.comment.delete',
  'notifications.notification.read',
  'notifications.notification.update',
  'search.global.read',
  'dashboard.summary.read',
  'exports.job.create',
  'pdf.document.render',
  // finance SALES
  'invoices.read',
  'invoices.write',
  'invoices.send',
  'payments.read',
  'credit_notes.read',
  'coa.read',
  'journal_entries.read',
  'period_close.read',
  // identity STAFF_READ
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
  // sales role (sales domain)
  'items.item.read',
  'items.item.write',
  'items.category.read',
  'items.category.write',
  'items.unit.read',
  'items.unit.write',
  'taxes.tax.read',
  'currencies.currency.read',
  'currencies.exchange_rate.read',
  'payment_methods.method.read',
  'pricing_tiers.tier.read',
  'pricing_tiers.override.read',
  'pricing_tiers.override.write',
  'vas.service.read',
  'vas.service.write',
  'jobs.job_type.read',
  'quotes.quote.read',
  'quotes.quote.write',
  'quotes.quote.submit',
  'quotes.quote.revise',
  'quotes.quote.cancel',
  'quotes.send',
  'quotes.accept',
  'quotes.convert_to_project',
  'quotes.template.read',
  'quotes.template.write',
  'quotes.approval.read',
  'quotes.version.read',
  'quotes.pdf.read',
  'projects.project.read',
  'projects.project.write',
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
  // vendors_inventory_ops SALES_READ
  'vendors.vendor.read',
  'purchase_orders.purchase_order.read',
  'warehouses.warehouse.read',
  'stock.level.read',
  'shipments.shipment.read',
];

const OPS_CAPS: ReadonlyArray<Capability> = [
  // org.* (read-only-internal)
  'org.organization.read',
  'org.member.read',
  'org.branding.read',
  'org.feature_flag.read',
  // crm OPS
  'crm.customers.read',
  'crm.contacts.read',
  'crm.activities.read',
  'crm.activities.write',
  'crm.leads.read',
  'crm.opportunities.read',
  // cross_cutting INTERNAL_AUTHOR
  'audit_log.entry.read',
  'attachments.attachment.read',
  'attachments.attachment.create',
  'attachments.attachment.delete',
  'comments.comment.read',
  'comments.comment.create',
  'comments.comment.delete',
  'notifications.notification.read',
  'notifications.notification.update',
  'search.global.read',
  'dashboard.summary.read',
  'exports.job.create',
  'pdf.document.render',
  // finance OPS
  'invoices.read',
  'payments.read',
  'credit_notes.read',
  // identity STAFF_READ
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
  // sales OPS
  'items.item.read',
  'items.category.read',
  'items.unit.read',
  'currencies.currency.read',
  'vas.service.read',
  'jobs.job_type.read',
  'quotes.quote.read',
  'quotes.version.read',
  'quotes.pdf.read',
  'projects.project.read',
  'projects.project.write',
  'projects.transition',
  'projects.phase.read',
  'projects.phase.write',
  'projects.phase.transition',
  'projects.phase.reorder',
  'projects.line_item.read',
  'projects.line_item.update',
  // vendors_inventory_ops OPS_CAPS
  'vendors.vendor.read',
  'vendors.vendor.create',
  'vendors.vendor.update',
  'purchase_orders.purchase_order.read',
  'purchase_orders.purchase_order.create',
  'purchase_orders.purchase_order.update',
  'purchase_orders.purchase_order.transition',
  'purchase_orders.line_item.write',
  'vendor_bills.vendor_bill.read',
  'expenses.expense.read',
  'expenses.expense.create',
  'expenses.expense.submit',
  'warehouses.warehouse.read',
  'warehouses.warehouse.create',
  'warehouses.warehouse.update',
  'stock.level.read',
  'stock.movement.read',
  'stock.bom.read',
  'stock.bom.write',
  'receiving.order.read',
  'receiving.order.create',
  'receiving.order.update',
  'receiving.receive',
  'receiving.line_item.read',
  'receiving.line_item.create',
  'receiving.line_item.update',
  'receiving.line_item.delete',
  'production.run.read',
  'production.run.create',
  'production.run.update',
  'production.start',
  'production.complete',
  'manufacturing.run.create',
  'manufacturing.run.update',
  'manufacturing.run.delete',
  'manufacturing.run.start',
  'manufacturing.run.complete',
  'manufacturing.run.cancel',
  'manufacturing.run.line_item.create',
  'manufacturing.run.line_item.update',
  'manufacturing.run.line_item.delete',
  'shipments.shipment.read',
  'shipments.shipment.create',
  'shipments.shipment.update',
  'shipments.ship',
  'shipment.line_item.read',
  'shipment.line_item.create',
  'shipment.line_item.update',
  'shipment.line_item.delete',
];

const ACCOUNTING_CAPS: ReadonlyArray<Capability> = [
  // org.* (read-only-internal)
  'org.organization.read',
  'org.member.read',
  'org.branding.read',
  'org.feature_flag.read',
  // crm ACCOUNTING
  'crm.customers.read',
  'crm.customers.invite_to_portal',
  'crm.contacts.read',
  'crm.activities.read',
  'crm.leads.read',
  'crm.opportunities.read',
  // cross_cutting INTERNAL_AUTHOR
  'audit_log.entry.read',
  'attachments.attachment.read',
  'attachments.attachment.create',
  'attachments.attachment.delete',
  'comments.comment.read',
  'comments.comment.create',
  'comments.comment.delete',
  'notifications.notification.read',
  'notifications.notification.update',
  'search.global.read',
  'dashboard.summary.read',
  'exports.job.create',
  'pdf.document.render',
  'kitcost.dashboard.view',
  // finance ACCOUNTING
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
  // identity STAFF_READ
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
  // sales ACCOUNTING
  'items.item.read',
  'items.category.read',
  'items.unit.read',
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
  'jobs.job_type.read',
  'quotes.quote.read',
  'quotes.quote.write',
  'quotes.quote.approve',
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
  'projects.transition',
  'projects.phase.read',
  'projects.phase.transition',
  'projects.line_item.read',
  'projects.convert_to_invoice',
  // vendors_inventory_ops ACCOUNTING
  'vendors.vendor.read',
  'vendors.vendor.create',
  'vendors.vendor.update',
  'purchase_orders.purchase_order.read',
  'vendor_bills.vendor_bill.read',
  'vendor_bills.vendor_bill.create',
  'vendor_bills.vendor_bill.update',
  'vendor_bills.vendor_bill.transition',
  'vendor_bills.payment.write',
  'expenses.expense.read',
  'expenses.expense.create',
  'expenses.expense.update',
  'expenses.expense.approve',
  'expenses.expense.pay',
  'expenses.expense.reject',
  'expenses.category.write',
  'warehouses.warehouse.read',
  'stock.level.read',
  'stock.movement.read',
  'receiving.order.read',
  'receiving.line_item.read',
  'production.run.read',
  'shipments.shipment.read',
  'shipment.line_item.read',
];

const VIEWER_CAPS: ReadonlyArray<Capability> = [
  // org.* (read-only-internal plus audit log)
  'org.organization.read',
  'org.member.read',
  'org.branding.read',
  'org.feature_flag.read',
  'org.audit_log.read',
  // crm VIEWER
  'crm.customers.read',
  'crm.contacts.read',
  'crm.activities.read',
  'crm.leads.read',
  'crm.opportunities.read',
  // cross_cutting INTERNAL_READ
  'audit_log.entry.read',
  'attachments.attachment.read',
  'comments.comment.read',
  'notifications.notification.read',
  'notifications.notification.update',
  'search.global.read',
  'dashboard.summary.read',
  'pdf.document.render',
  // finance VIEWER
  'invoices.read',
  'payments.read',
  'credit_notes.read',
  'coa.read',
  'journal_entries.read',
  'period_close.read',
  // identity VIEWER_SET
  'identity.session.read',
  'identity.user.read.self',
  'identity.user.update.self',
  'tenancy.org.read',
  'tenancy.memberships.read',
  'branding.read',
  'settings.read',
  'flags.read',
  // sales VIEWER
  'items.item.read',
  'items.category.read',
  'items.unit.read',
  'taxes.tax.read',
  'currencies.currency.read',
  'currencies.exchange_rate.read',
  'payment_methods.method.read',
  'pricing_tiers.tier.read',
  'pricing_tiers.override.read',
  'vas.service.read',
  'jobs.job_type.read',
  'quotes.quote.read',
  'quotes.version.read',
  'quotes.pdf.read',
  'quotes.template.read',
  'quotes.approval.read',
  'projects.project.read',
  'projects.phase.read',
  'projects.line_item.read',
  // vendors_inventory_ops VIEWER
  'vendors.vendor.read',
  'purchase_orders.purchase_order.read',
  'vendor_bills.vendor_bill.read',
  'expenses.expense.read',
  'warehouses.warehouse.read',
  'stock.level.read',
  'stock.movement.read',
  'stock.bom.read',
  'receiving.order.read',
  'receiving.line_item.read',
  'production.run.read',
  'shipments.shipment.read',
  'shipment.line_item.read',
];

const CUSTOMER_PORTAL_CAPS: ReadonlyArray<Capability> = [
  // org.* (external)
  'org.organization.read',
  'org.branding.read',
  // cross_cutting PORTAL_CAPS
  'portal.customer.read',
  'portal.invoice.read',
  'portal.quote.read',
  'portal.project.read',
  'portal.attachment.read',
  'attachments.attachment.read',
  'pdf.document.render',
  // identity EXTERNAL_SET
  'identity.session.read',
  'identity.user.read.self',
  'identity.user.update.self',
  'tenancy.org.read',
  'branding.read',
  // sales EXTERNAL
  'quotes.quote.read',
  'quotes.pdf.read',
  'projects.project.read',
  'projects.phase.read',
];

const VENDOR_PORTAL_CAPS: ReadonlyArray<Capability> = [
  // org.* (external)
  'org.organization.read',
  'org.branding.read',
  // cross_cutting VENDOR_PORTAL is intentionally empty (deferred per AUDIT)
  // identity EXTERNAL_SET
  'identity.session.read',
  'identity.user.read.self',
  'identity.user.update.self',
  'tenancy.org.read',
  'branding.read',
  // vendors_inventory_ops VENDOR_PORTAL
  'purchase_orders.purchase_order.read',
  'vendor_bills.vendor_bill.read',
];

export const CAPABILITIES_BY_ROLE: Readonly<
  Record<RoleCode, ReadonlyArray<Capability>>
> = {
  org_owner:     OWNER_CAPS,
  org_admin:     ADMIN_CAPS,
  sales:         SALES_CAPS,
  ops:           OPS_CAPS,
  accounting:    ACCOUNTING_CAPS,
  viewer:        VIEWER_CAPS,
  customer_user: CUSTOMER_PORTAL_CAPS,
  vendor_user:   VENDOR_PORTAL_CAPS,
};

export function hasCap(role: RoleCode, cap: Capability): boolean {
  return CAPABILITIES_BY_ROLE[role].includes(cap);
}
