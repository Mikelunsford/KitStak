// Sales-domain Zod canon. Byte-mirror of apps/web/src/lib/types/sales.ts.
// Every monetary field uses CentsSchema; the wire accepts integer or string
// so BigInt can round-trip without lossy float coercion.

import { z } from 'zod';

export const CentsSchema = z.union([
  z.number().int(),
  z.string().regex(/^-?\d+$/),
]);
export const BpsSchema = z.number().int().min(0).max(100_000);
export const QuantityE3Schema = z.union([
  z.number().int().min(0),
  z.string().regex(/^\d+$/),
]);
export const UuidSchema = z.string().uuid();

// ---------------------------------------------------------------------------
// currencies + exchange rates
// ---------------------------------------------------------------------------

export const CurrencySchema = z.object({
  code: z.string().length(3),
  name: z.string(),
  symbol: z.string().nullable(),
  is_zero_decimal: z.boolean(),
  is_active: z.boolean(),
});
export type Currency = z.infer<typeof CurrencySchema>;

export const ExchangeRateSchema = z.object({
  id: UuidSchema,
  base_currency_code: z.string().length(3),
  quote_currency_code: z.string().length(3),
  rate_e9: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
  effective_date: z.string(),
  source: z.string(),
});
export type ExchangeRate = z.infer<typeof ExchangeRateSchema>;

export const ExchangeRateCreateSchema = z.object({
  base_currency_code: z.string().length(3),
  quote_currency_code: z.string().length(3),
  rate_e9: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
  effective_date: z.string(),
  source: z.string().optional(),
});
export type ExchangeRateCreate = z.infer<typeof ExchangeRateCreateSchema>;

// ---------------------------------------------------------------------------
// taxes + payment_methods + pricing_tiers + customer_pricing_overrides
// ---------------------------------------------------------------------------

export const TaxSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  code: z.string(),
  name: z.string(),
  rate_bps: BpsSchema,
  is_compound: z.boolean(),
  is_active: z.boolean(),
  default_for_org: z.boolean(),
  notes: z.string().nullable(),
});
export type Tax = z.infer<typeof TaxSchema>;

export const TaxCreateSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  rate_bps: BpsSchema,
  is_compound: z.boolean().optional(),
  is_active: z.boolean().optional(),
  default_for_org: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});
export type TaxCreate = z.infer<typeof TaxCreateSchema>;

export const TaxPatchSchema = TaxCreateSchema.partial();
export type TaxPatch = z.infer<typeof TaxPatchSchema>;

export const PaymentMethodKindSchema = z.enum([
  'manual', 'ach', 'wire', 'card', 'check', 'other',
]);
export type PaymentMethodKind = z.infer<typeof PaymentMethodKindSchema>;

export const PaymentMethodSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  code: z.string(),
  label: z.string(),
  kind: PaymentMethodKindSchema,
  is_active: z.boolean(),
  default_for_org: z.boolean(),
  notes: z.string().nullable(),
});
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

export const PaymentMethodCreateSchema = z.object({
  code: z.string().min(1),
  label: z.string().min(1),
  kind: PaymentMethodKindSchema.optional(),
  is_active: z.boolean().optional(),
  default_for_org: z.boolean().optional(),
  notes: z.string().nullable().optional(),
});
export type PaymentMethodCreate = z.infer<typeof PaymentMethodCreateSchema>;

export const PaymentMethodPatchSchema = PaymentMethodCreateSchema.partial();
export type PaymentMethodPatch = z.infer<typeof PaymentMethodPatchSchema>;

export const PricingTierSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  code: z.string(),
  name: z.string(),
  discount_bps: BpsSchema,
  is_active: z.boolean(),
  sort_order: z.number().int(),
});
export type PricingTier = z.infer<typeof PricingTierSchema>;

export const PricingTierCreateSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  discount_bps: BpsSchema.optional(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
});
export type PricingTierCreate = z.infer<typeof PricingTierCreateSchema>;

export const PricingTierPatchSchema = PricingTierCreateSchema.partial();
export type PricingTierPatch = z.infer<typeof PricingTierPatchSchema>;

export const CustomerPricingOverrideSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  customer_id: UuidSchema,
  item_id: UuidSchema,
  unit_price_cents: CentsSchema.nullable(),
  discount_bps: BpsSchema.nullable(),
  currency_code: z.string().length(3).nullable(),
  is_active: z.boolean(),
  effective_from: z.string().nullable(),
  effective_to: z.string().nullable(),
});
export type CustomerPricingOverride = z.infer<typeof CustomerPricingOverrideSchema>;

// ---------------------------------------------------------------------------
// items + categories + units
// ---------------------------------------------------------------------------

export const UnitSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  code: z.string(),
  label: z.string(),
  is_active: z.boolean(),
});
export type Unit = z.infer<typeof UnitSchema>;

export const ItemCategorySchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  code: z.string(),
  name: z.string(),
  parent_id: UuidSchema.nullable(),
  is_active: z.boolean(),
  sort_order: z.number().int(),
});
export type ItemCategory = z.infer<typeof ItemCategorySchema>;

export const ItemKindSchema = z.enum([
  'product', 'service', 'kit', 'subscription', 'bundle',
]);
export type ItemKind = z.infer<typeof ItemKindSchema>;

// Material supply source (migration 0120). in_house and vendor_consigned carry
// normal captured cost; customer_supplied and third_party_consigned roll up as
// zero org material cost. Per-line overrides on consumption lines win over this
// item default (COALESCE(line, item)).
export const ItemSupplySourceSchema = z.enum([
  'in_house', 'customer_supplied', 'vendor_consigned', 'third_party_consigned',
]);
export type ItemSupplySource = z.infer<typeof ItemSupplySourceSchema>;

export const ItemSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  sku: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  category_id: UuidSchema.nullable(),
  unit_id: UuidSchema.nullable(),
  kind: ItemKindSchema,
  unit_price_cents: CentsSchema,
  unit_cost_cents: CentsSchema.nullable(),
  cost_cents: CentsSchema.nullable(),
  currency_code: z.string().length(3),
  default_tax_id: UuidSchema.nullable(),
  unit_of_measure: z.string().nullable(),
  reorder_point: z.number().nonnegative().nullable(),
  barcode: z.string().nullable(),
  supply_source: ItemSupplySourceSchema,
  is_active: z.boolean(),
  is_taxable: z.boolean(),
  is_sellable: z.boolean(),
  is_purchasable: z.boolean(),
  metadata: z.record(z.unknown()),
});
export type Item = z.infer<typeof ItemSchema>;

export const ItemCreateSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  kind: ItemKindSchema.optional(),
  unit_price_cents: CentsSchema.optional(),
  unit_cost_cents: CentsSchema.optional().nullable(),
  cost_cents: CentsSchema.optional().nullable(),
  currency_code: z.string().length(3).optional(),
  unit_of_measure: z.string().optional().nullable(),
  reorder_point: z.number().nonnegative().optional().nullable(),
  barcode: z.string().optional().nullable(),
  supply_source: ItemSupplySourceSchema.optional(),
  is_active: z.boolean().optional(),
  is_taxable: z.boolean().optional(),
  is_sellable: z.boolean().optional(),
  is_purchasable: z.boolean().optional(),
});
export type ItemCreate = z.infer<typeof ItemCreateSchema>;

export const ItemPatchSchema = ItemCreateSchema.partial();
export type ItemPatch = z.infer<typeof ItemPatchSchema>;

// ---------------------------------------------------------------------------
// VAS + job types
// ---------------------------------------------------------------------------

export const VasKindSchema = z.enum(['flat', 'per_unit', 'hourly', 'tiered']);
export type VasKind = z.infer<typeof VasKindSchema>;

export const ValueAddedServiceSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  kind: VasKindSchema,
  base_price_cents: CentsSchema,
  currency_code: z.string().length(3),
  default_tax_id: UuidSchema.nullable(),
  is_active: z.boolean(),
});
export type ValueAddedService = z.infer<typeof ValueAddedServiceSchema>;

export const ValueAddedServiceCreateSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  kind: VasKindSchema.optional(),
  base_price_cents: CentsSchema.optional(),
  currency_code: z.string().length(3).optional(),
  default_tax_id: UuidSchema.nullable().optional(),
  is_active: z.boolean().optional(),
});
export type ValueAddedServiceCreate = z.infer<typeof ValueAddedServiceCreateSchema>;

export const ValueAddedServicePatchSchema = ValueAddedServiceCreateSchema.partial();
export type ValueAddedServicePatch = z.infer<typeof ValueAddedServicePatchSchema>;

export const JobTypeSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  is_active: z.boolean(),
  sort_order: z.number().int(),
});
export type JobType = z.infer<typeof JobTypeSchema>;

// ---------------------------------------------------------------------------
// quotes + line items + versions + approvals + templates
// ---------------------------------------------------------------------------

export const QuoteStateSchema = z.enum([
  'draft', 'submitted', 'revise_requested',
  'approved', 'project_pending', 'cancelled',
]);
export type QuoteState = z.infer<typeof QuoteStateSchema>;

export const QuoteSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  number: z.string(),
  customer_id: UuidSchema.nullable(),
  // Wave 12 / A3 (3PL quote integration): the job type this quote is scoped
  // to, carried to the project by convert_quote_to_project so a won quote
  // becomes a project of the right type. Optional on read so the additive
  // 0093 column never fails a quote parse in the deploy window before the
  // migration lands.
  job_type_id: UuidSchema.nullable().optional(),
  // Wave 12 / A4 (project conversion with template snapshotting): the Job
  // Builder template that populated this quote. Set at apply time alongside
  // job_type_id and carried to the project by convert_quote_to_project so the
  // project records its origin. Optional on read so the additive 0094 column
  // never fails a quote parse in the deploy window before the migration lands.
  source_job_template_id: UuidSchema.nullable().optional(),
  state: QuoteStateSchema,
  submitted_at: z.string().nullable(),
  revise_requested_at: z.string().nullable(),
  approved_at: z.string().nullable(),
  project_pending_at: z.string().nullable(),
  cancelled_at: z.string().nullable(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  expiration_date: z.string().nullable(),
  currency_code: z.string().length(3),
  subtotal_cents: CentsSchema,
  discount_cents: CentsSchema,
  tax_cents: CentsSchema,
  total_cents: CentsSchema,
  default_tax_id: UuidSchema.nullable(),
  payment_method_id: UuidSchema.nullable(),
  pricing_tier_id: UuidSchema.nullable(),
  requires_approval: z.boolean(),
  notes: z.string().nullable(),
  internal_notes: z.string().nullable(),
  sent_at: z.string().nullable(),
  accepted_at: z.string().nullable(),
  converted_to_project_id: UuidSchema.nullable(),
});
export type Quote = z.infer<typeof QuoteSchema>;

export const QuoteLineKindSchema = z.enum(['item', 'vas', 'discount', 'note']);
export type QuoteLineKind = z.infer<typeof QuoteLineKindSchema>;

// ADR 0005: how a line is billed. one_time (the historical behaviour) or
// monthly (recurring, e.g. storage). Forward-extensible without a model change.
// Distinct from the org's own Stripe subscription_status.
export const BillingIntervalSchema = z.enum(['one_time', 'monthly']);
export type BillingInterval = z.infer<typeof BillingIntervalSchema>;

export const QuoteLineItemSchema = z.object({
  id: UuidSchema,
  quote_id: UuidSchema,
  position: z.number().int(),
  item_id: UuidSchema.nullable(),
  vas_id: UuidSchema.nullable(),
  sku: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  kind: QuoteLineKindSchema,
  quantity_e3: QuantityE3Schema,
  unit_price_cents: CentsSchema,
  discount_bps: BpsSchema,
  tax_id: UuidSchema.nullable(),
  tax_rate_snapshot: BpsSchema,
  is_taxable: z.boolean(),
  billing_interval: BillingIntervalSchema,
  tier_id: UuidSchema.nullable(),
  line_subtotal_cents: CentsSchema,
  line_discount_cents: CentsSchema,
  line_tax_cents: CentsSchema,
  line_total_cents: CentsSchema,
});
export type QuoteLineItem = z.infer<typeof QuoteLineItemSchema>;

// ADR 0004: a quantity-break tier of one quote. Each tier owns its lines
// (quote_line_items.tier_id) and its per-tier totals.
export const QuoteTierSchema = z.object({
  id: UuidSchema,
  quote_id: UuidSchema,
  label: z.string(),
  break_quantity_e3: QuantityE3Schema,
  sort_order: z.number().int(),
  subtotal_cents: CentsSchema,
  discount_cents: CentsSchema,
  tax_cents: CentsSchema,
  total_cents: CentsSchema,
});
export type QuoteTier = z.infer<typeof QuoteTierSchema>;

export const QuoteVersionSchema = z.object({
  id: UuidSchema,
  quote_id: UuidSchema,
  version_number: z.number().int(),
  triggered_state: z.string(),
  payload_jsonb: z.unknown(),
  created_at: z.string(),
});
export type QuoteVersion = z.infer<typeof QuoteVersionSchema>;

export const QuoteApprovalDecisionSchema = z.enum([
  'pending', 'approved', 'rejected', 'cancelled',
]);
export type QuoteApprovalDecision = z.infer<typeof QuoteApprovalDecisionSchema>;

export const QuoteApprovalSchema = z.object({
  id: UuidSchema,
  quote_id: UuidSchema,
  requested_by: UuidSchema.nullable(),
  requested_at: z.string(),
  approver_id: UuidSchema.nullable(),
  decision: QuoteApprovalDecisionSchema,
  decided_at: z.string().nullable(),
  reason: z.string().nullable(),
});
export type QuoteApproval = z.infer<typeof QuoteApprovalSchema>;

export const QuoteTemplateSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  default_currency_code: z.string().length(3).nullable(),
  default_tax_id: UuidSchema.nullable(),
  default_payment_method_id: UuidSchema.nullable(),
  line_items_jsonb: z.unknown(),
  footer_text: z.string().nullable(),
  is_active: z.boolean(),
});
export type QuoteTemplate = z.infer<typeof QuoteTemplateSchema>;

// ---------------------------------------------------------------------------
// Wave 12 / A4 (project conversion with template snapshotting). When a quote
// built from a Job Builder template converts to a project,
// convert_quote_to_project freezes the template (header plus lines) into
// projects.job_template_snapshot so later template edits never rewrite the
// project's origin. The shape is server-authored in migration 0094; fields are
// lenient (.optional()) so a future snapshot field never fails an existing
// project parse. rate_cents stays the wire Cents (integer or numeric-string).
// ---------------------------------------------------------------------------

export const JobTemplateSnapshotLineSchema = z.object({
  id: UuidSchema.nullable().optional(),
  line_kind: z.string(),
  item_id: UuidSchema.nullable().optional(),
  vas_id: UuidSchema.nullable().optional(),
  name: z.string(),
  quantity: z.union([z.number(), z.string()]).nullable().optional(),
  rate_cents: CentsSchema.nullable().optional(),
  rate_uom: z.string().nullable().optional(),
  currency_code: z.string().nullable().optional(),
  position: z.number().int(),
});
export type JobTemplateSnapshotLine = z.infer<typeof JobTemplateSnapshotLineSchema>;

export const JobTemplateSnapshotSchema = z.object({
  snapshot_at: z.string().optional(),
  template_id: UuidSchema,
  template_number: z.string().nullable().optional(),
  name: z.string(),
  variant: z.string(),
  job_type_id: UuidSchema.nullable().optional(),
  default_bom_item_id: UuidSchema.nullable().optional(),
  status: z.string().optional(),
  notes: z.string().nullable().optional(),
  lines: z.array(JobTemplateSnapshotLineSchema),
});
export type JobTemplateSnapshot = z.infer<typeof JobTemplateSnapshotSchema>;

// ---------------------------------------------------------------------------
// projects + project_phases
// ---------------------------------------------------------------------------

export const ProjectStateSchema = z.enum([
  'pending', 'ready_to_build', 'in_production',
  'ready_to_ship', 'completed', 'cancelled',
]);
export type ProjectState = z.infer<typeof ProjectStateSchema>;

export const ProjectSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  number: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  customer_id: UuidSchema.nullable(),
  source_quote_id: UuidSchema.nullable(),
  job_type_id: UuidSchema.nullable(),
  // Wave 12 / A4: the Job Builder template this project was built from, carried
  // from the quote by convert_quote_to_project, plus the frozen snapshot of that
  // template at convert time. Both nullable (spine projects with no 3PL template
  // leave them null) and optional on read so the additive 0094 columns never
  // fail a project parse in the deploy window before the migration lands.
  source_job_template_id: UuidSchema.nullable().optional(),
  job_template_snapshot: JobTemplateSnapshotSchema.nullable().optional(),
  state: ProjectStateSchema,
  pending_at: z.string().nullable(),
  ready_to_build_at: z.string().nullable(),
  in_production_at: z.string().nullable(),
  ready_to_ship_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  cancelled_at: z.string().nullable(),
  start_date: z.string().nullable(),
  due_date: z.string().nullable(),
  currency_code: z.string().length(3),
  budget_cents: CentsSchema,
  notes: z.string().nullable(),
  internal_notes: z.string().nullable(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const ProjectPhaseStateSchema = z.enum([
  'pending', 'active', 'completed', 'cancelled',
]);
export type ProjectPhaseState = z.infer<typeof ProjectPhaseStateSchema>;

export const ProjectPhaseSchema = z.object({
  id: UuidSchema,
  project_id: UuidSchema,
  position: z.number().int(),
  name: z.string(),
  description: z.string().nullable(),
  state: ProjectPhaseStateSchema,
  pending_at: z.string().nullable(),
  active_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  cancelled_at: z.string().nullable(),
  start_date: z.string().nullable(),
  due_date: z.string().nullable(),
});
export type ProjectPhase = z.infer<typeof ProjectPhaseSchema>;

// ---------------------------------------------------------------------------
// Request / response payload schemas
// ---------------------------------------------------------------------------

export const CreateQuoteRequestSchema = z.object({
  // F-Wave9-AUTO-NUMBERING-01 (B8): operator can leave this blank and the
  // quotes-api handler allocates the next Q-YYYY-NNNNN via the org-scoped
  // numbering chassis (next_doc_number / 0038). Operator-supplied numbers
  // still win. Empty string is treated as absent.
  number: z.string().min(1).optional(),
  customer_id: UuidSchema.nullable().optional(),
  // Wave 12 / A3: optional 3PL job type; assertRefInOrg('job_types') guards
  // it server-side, rides quotes.quote.write (no new capability).
  job_type_id: UuidSchema.nullable().optional(),
  // Wave 12 / A4: optional source Job Builder template; assertRefInOrg
  // ('job_templates') guards it server-side, rides quotes.quote.write. The SPA
  // sets it on the apply-template PATCH so the quote (and the project it
  // converts to) records which template built it.
  source_job_template_id: UuidSchema.nullable().optional(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  currency_code: z.string().length(3).default('USD'),
  expiration_date: z.string().nullable().optional(),
  default_tax_id: UuidSchema.nullable().optional(),
  payment_method_id: UuidSchema.nullable().optional(),
  pricing_tier_id: UuidSchema.nullable().optional(),
  notes: z.string().nullable().optional(),
  internal_notes: z.string().nullable().optional(),
});
export type CreateQuoteRequest = z.infer<typeof CreateQuoteRequestSchema>;

export const UpdateQuoteRequestSchema = CreateQuoteRequestSchema.partial();
export type UpdateQuoteRequest = z.infer<typeof UpdateQuoteRequestSchema>;

export const CreateQuoteLineRequestSchema = z.object({
  position: z.number().int().optional(),
  item_id: UuidSchema.nullable().optional(),
  vas_id: UuidSchema.nullable().optional(),
  sku: z.string().nullable().optional(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  kind: QuoteLineKindSchema.default('item'),
  quantity_e3: QuantityE3Schema.default(1000),
  unit_price_cents: CentsSchema.default(0),
  discount_bps: BpsSchema.default(0),
  tax_id: UuidSchema.nullable().optional(),
  is_taxable: z.boolean().default(true),
  billing_interval: BillingIntervalSchema.default('one_time'),
  // ADR 0004: assign the line to one of the quote's tiers. Optional + nullable
  // (no default) so existing line-request constructors are unaffected.
  tier_id: UuidSchema.nullable().optional(),
});
export type CreateQuoteLineRequest = z.infer<typeof CreateQuoteLineRequestSchema>;

// Inline draft-line edit. PATCH /quotes/:id/line-items/:lineId overlays only the
// sent fields onto the existing line, then the handler RE-COMPUTES the four
// server-derived line_*_cents from the merged values via computeLineMath. Every
// editable field is optional so the operator can change one cell at a time.
//
// FROZEN: `kind` is deliberately omitted. The kind (item / vas / discount /
// note) changes the meaning of a line; allowing it to flip on a partial edit
// would let an item line silently become a discount line. A kind change is a
// remove-plus-add, not an in-place edit.
//
// OMITTED (server-derived, ignored if a client sends them): line_subtotal_cents,
// line_discount_cents, line_tax_cents, line_total_cents. These are always
// recomputed server-side from the trusted inputs; a forged total can never
// reach the quote header sum (recompute_quote_totals).
//
// tax_rate_snapshot is also server-owned: when tax_id is sent the handler
// re-resolves it from taxes.rate_bps (the DB BEFORE-INSERT snapshot trigger
// does not fire on UPDATE).
export const UpdateQuoteLineRequestSchema = z.object({
  position: z.number().int().optional(),
  item_id: UuidSchema.nullable().optional(),
  vas_id: UuidSchema.nullable().optional(),
  sku: z.string().nullable().optional(),
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  quantity_e3: QuantityE3Schema.optional(),
  unit_price_cents: CentsSchema.optional(),
  discount_bps: BpsSchema.optional(),
  tax_id: UuidSchema.nullable().optional(),
  is_taxable: z.boolean().optional(),
  billing_interval: BillingIntervalSchema.optional(),
  // ADR 0004: reassign or clear (null) the line's tier on an inline edit.
  tier_id: UuidSchema.nullable().optional(),
});
export type UpdateQuoteLineRequest = z.infer<typeof UpdateQuoteLineRequestSchema>;

// ADR 0004 tier CRUD requests. The per-tier totals (subtotal/discount/tax/
// total_cents) are server-derived by recompute_quote_totals from the tier's
// lines and are never client-settable, so these shapes carry only the
// operator-editable fields. break_quantity_e3 and sort_order are optional (no
// default) so a constructor may omit them; the handler defaults them.
export const CreateQuoteTierRequestSchema = z.object({
  label: z.string().min(1),
  break_quantity_e3: QuantityE3Schema.optional(),
  sort_order: z.number().int().optional(),
});
export type CreateQuoteTierRequest = z.infer<typeof CreateQuoteTierRequestSchema>;

export const UpdateQuoteTierRequestSchema = z.object({
  label: z.string().min(1).optional(),
  break_quantity_e3: QuantityE3Schema.optional(),
  sort_order: z.number().int().optional(),
});
export type UpdateQuoteTierRequest = z.infer<typeof UpdateQuoteTierRequestSchema>;

// Reorder a quote's tiers in one call: tier_ids is the new order and each tier's
// sort_order becomes its index. The handler requires the list to name exactly
// the quote's tiers.
export const ReorderQuoteTiersRequestSchema = z.object({
  tier_ids: z.array(UuidSchema).min(1),
});
export type ReorderQuoteTiersRequest = z.infer<typeof ReorderQuoteTiersRequestSchema>;

export const ConvertQuoteToProjectRequestSchema = z.object({
  project_number: z.string().nullable().optional(),
});
export type ConvertQuoteToProjectRequest = z.infer<
  typeof ConvertQuoteToProjectRequestSchema
>;

export const CreateProjectRequestSchema = z.object({
  number: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  customer_id: UuidSchema.nullable().optional(),
  job_type_id: UuidSchema.nullable().optional(),
  currency_code: z.string().length(3).default('USD'),
  budget_cents: CentsSchema.default(0),
  start_date: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
});
export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;

export const TransitionRequestSchema = z.object({
  to: z.string(),
  reason: z.string().nullable().optional(),
});
export type TransitionRequest = z.infer<typeof TransitionRequestSchema>;

export const ReorderPhasesRequestSchema = z.object({
  phase_ids: z.array(UuidSchema).min(1),
});
export type ReorderPhasesRequest = z.infer<typeof ReorderPhasesRequestSchema>;

// ---------------------------------------------------------------------------
// project_line_items (carryover target for convert_quote_to_project, shipped
// in migration 0044). The discount_percent column is operator-facing percent
// (0..100) rather than the basis-points form used on quote_line_items; the
// RPC translates between the two during conversion.
// ---------------------------------------------------------------------------

export const ProjectLineItemSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  project_id: UuidSchema,
  item_id: UuidSchema.nullable(),
  source_quote_line_item_id: UuidSchema.nullable(),
  name: z.string(),
  description: z.string().nullable(),
  quantity: z.union([z.number(), z.string()]),
  unit_price_cents: CentsSchema,
  tax_rate_id: UuidSchema.nullable(),
  discount_percent: z.union([z.number(), z.string()]),
  position: z.number().int(),
});
export type ProjectLineItem = z.infer<typeof ProjectLineItemSchema>;

export const CreateProjectLineItemRequestSchema = z.object({
  item_id: UuidSchema.nullable().optional(),
  source_quote_line_item_id: UuidSchema.nullable().optional(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  quantity: z.union([z.number().nonnegative(), z.string().regex(/^\d+(\.\d+)?$/)])
    .default(0),
  unit_price_cents: CentsSchema.default(0),
  tax_rate_id: UuidSchema.nullable().optional(),
  discount_percent: z.union([
    z.number().min(0).max(100),
    z.string().regex(/^\d+(\.\d+)?$/),
  ]).default(0),
  position: z.number().int().optional(),
});
export type CreateProjectLineItemRequest = z.infer<
  typeof CreateProjectLineItemRequestSchema
>;

export const UpdateProjectLineItemRequestSchema =
  CreateProjectLineItemRequestSchema.partial();
export type UpdateProjectLineItemRequest = z.infer<
  typeof UpdateProjectLineItemRequestSchema
>;

// ---------------------------------------------------------------------------
// convert_project_to_invoice response (shipped in migration 0045). The
// projects-api handler returns the new invoice id so the SPA can route the
// operator straight to the draft invoice.
// ---------------------------------------------------------------------------

export const ConvertProjectToInvoiceResponseSchema = z.object({
  invoice_id: UuidSchema,
});
export type ConvertProjectToInvoiceResponse = z.infer<
  typeof ConvertProjectToInvoiceResponseSchema
>;
