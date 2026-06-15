// Side-car canon: 3PL commercial layer Zod types (Accounts Phase A1, Job
// Builder Phase A2).
// Byte-identical pair: apps/web/src/lib/types/threepl.ts.
// Drift is a release blocker.
//
// Tables (migration 0089): three_pl_accounts (the service-relationship layer
// over a CRM customer; status active/inactive flag, not a registered FSM) and
// account_service_definitions (the per-account Rate Card overlay).
// Tables (migration 0091): job_templates (the Job Builder engine; variant
// preset, status active/inactive flag) and job_template_lines (component,
// service, and step lines). Money is BIGINT _cents carried on the wire as a
// number or numeric-string; quantities are numeric.

import { z } from 'zod';

const Uuid = z.string().uuid();
const Cents = z.union([z.number().int(), z.string().regex(/^-?\d+$/)]);
const Iso = z.string();
const Currency = z.string().length(3);

// ---------------------------------------------------------------------------
// three_pl_accounts (parent; status active/inactive flag, no rich FSM)
// ---------------------------------------------------------------------------

export const ThreePlAccountStatusSchema = z.enum([
  'active',
  'inactive',
]);
export type ThreePlAccountStatus = z.infer<typeof ThreePlAccountStatusSchema>;

export const ThreePlAccountSchema = z.object({
  id: Uuid,
  org_id: Uuid,
  customer_id: Uuid,
  account_number: z.string().nullable(),
  name: z.string(),
  status: ThreePlAccountStatusSchema,
  notes: z.string().nullable(),
  payload: z.record(z.unknown()),
  created_at: Iso,
  updated_at: Iso,
});
export type ThreePlAccount = z.infer<typeof ThreePlAccountSchema>;

export const ThreePlAccountCreateSchema = z.object({
  customer_id: Uuid,
  name: z.string().min(1),
  account_number: z.string().optional().nullable(),
  status: ThreePlAccountStatusSchema.optional(),
  notes: z.string().optional().nullable(),
  payload: z.record(z.unknown()).optional(),
});
export type ThreePlAccountCreate = z.infer<typeof ThreePlAccountCreateSchema>;

export const ThreePlAccountPatchSchema = ThreePlAccountCreateSchema.partial();
export type ThreePlAccountPatch = z.infer<typeof ThreePlAccountPatchSchema>;

// ---------------------------------------------------------------------------
// account_service_definitions (per-account Rate Card overlay; child of account)
// ---------------------------------------------------------------------------

export const AccountServiceKindSchema = z.enum([
  'copack',
  'kit',
  'rework',
  'inspection',
  'labeling',
  'storage',
  'custom',
]);
export type AccountServiceKind = z.infer<typeof AccountServiceKindSchema>;

export const AccountServiceDefinitionSchema = z.object({
  id: Uuid,
  org_id: Uuid,
  account_id: Uuid,
  vas_id: Uuid.nullable(),
  service_kind: AccountServiceKindSchema,
  name: z.string(),
  rate_cents: Cents.nullable(),
  rate_uom: z.string().nullable(),
  currency_code: Currency.nullable(),
  effective_from: Iso.nullable(),
  effective_to: Iso.nullable(),
  position: z.number().int(),
  created_at: Iso,
  updated_at: Iso,
});
export type AccountServiceDefinition = z.infer<typeof AccountServiceDefinitionSchema>;

export const AccountServiceDefinitionCreateSchema = z.object({
  service_kind: AccountServiceKindSchema.default('custom'),
  name: z.string().min(1),
  vas_id: Uuid.optional().nullable(),
  rate_cents: Cents.optional().nullable(),
  rate_uom: z.string().min(1).max(16).optional().nullable(),
  currency_code: Currency.optional().nullable(),
  effective_from: Iso.optional().nullable(),
  effective_to: Iso.optional().nullable(),
  position: z.number().int().optional(),
});
export type AccountServiceDefinitionCreate = z.infer<typeof AccountServiceDefinitionCreateSchema>;

export const AccountServiceDefinitionUpdateSchema =
  AccountServiceDefinitionCreateSchema.partial();
export type AccountServiceDefinitionUpdate = z.infer<typeof AccountServiceDefinitionUpdateSchema>;

// ---------------------------------------------------------------------------
// job_templates (parent; the Job Builder engine; status active/inactive flag,
// no rich FSM). template_number is filled by the numbering chassis (JB-, 0092).
// job_type_id references the spine job_types; default_bom_item_id references the
// parent item whose bom_items compose the default BOM (BOMs are item-keyed).
// ---------------------------------------------------------------------------

export const JobTemplateVariantSchema = z.enum([
  'kit',
  'sidekick',
  'repack',
  'labeling',
  'inspection',
  'custom',
]);
export type JobTemplateVariant = z.infer<typeof JobTemplateVariantSchema>;

export const JobTemplateStatusSchema = z.enum(['active', 'inactive']);
export type JobTemplateStatus = z.infer<typeof JobTemplateStatusSchema>;

export const JobTemplateSchema = z.object({
  id: Uuid,
  org_id: Uuid,
  template_number: z.string().nullable(),
  name: z.string(),
  variant: JobTemplateVariantSchema,
  job_type_id: Uuid.nullable(),
  default_bom_item_id: Uuid.nullable(),
  status: JobTemplateStatusSchema,
  notes: z.string().nullable(),
  payload: z.record(z.unknown()),
  created_at: Iso,
  updated_at: Iso,
});
export type JobTemplate = z.infer<typeof JobTemplateSchema>;

export const JobTemplateCreateSchema = z.object({
  name: z.string().min(1),
  variant: JobTemplateVariantSchema.optional(),
  job_type_id: Uuid.optional().nullable(),
  default_bom_item_id: Uuid.optional().nullable(),
  template_number: z.string().optional().nullable(),
  status: JobTemplateStatusSchema.optional(),
  notes: z.string().optional().nullable(),
  payload: z.record(z.unknown()).optional(),
});
export type JobTemplateCreate = z.infer<typeof JobTemplateCreateSchema>;

export const JobTemplatePatchSchema = JobTemplateCreateSchema.partial();
export type JobTemplatePatch = z.infer<typeof JobTemplatePatchSchema>;

// ---------------------------------------------------------------------------
// job_template_lines (child; builder definition lines). line_kind partitions
// component (item_id), service (vas_id), and step lines. rate_cents is BIGINT
// cents; quantity is numeric (number or numeric-string on the wire).
// ---------------------------------------------------------------------------

export const JobTemplateLineKindSchema = z.enum([
  'component',
  'service',
  'step',
]);
export type JobTemplateLineKind = z.infer<typeof JobTemplateLineKindSchema>;

export const JobTemplateLineSchema = z.object({
  id: Uuid,
  org_id: Uuid,
  template_id: Uuid,
  line_kind: JobTemplateLineKindSchema,
  item_id: Uuid.nullable(),
  vas_id: Uuid.nullable(),
  name: z.string(),
  quantity: z.union([z.number(), z.string()]).nullable(),
  rate_cents: Cents.nullable(),
  rate_uom: z.string().nullable(),
  currency_code: Currency.nullable(),
  position: z.number().int(),
  created_at: Iso,
  updated_at: Iso,
});
export type JobTemplateLine = z.infer<typeof JobTemplateLineSchema>;

export const JobTemplateLineCreateSchema = z.object({
  line_kind: JobTemplateLineKindSchema.default('component'),
  name: z.string().min(1),
  item_id: Uuid.optional().nullable(),
  vas_id: Uuid.optional().nullable(),
  quantity: z.union([z.number(), z.string()]).optional().nullable(),
  rate_cents: Cents.optional().nullable(),
  rate_uom: z.string().min(1).max(16).optional().nullable(),
  currency_code: Currency.optional().nullable(),
  position: z.number().int().optional(),
});
export type JobTemplateLineCreate = z.infer<typeof JobTemplateLineCreateSchema>;

export const JobTemplateLineUpdateSchema =
  JobTemplateLineCreateSchema.partial();
export type JobTemplateLineUpdate = z.infer<typeof JobTemplateLineUpdateSchema>;

// ---------------------------------------------------------------------------
// supply_plans (parent; Supply Plan, Phase A5; migration 0096). FSM draft /
// released / fulfilled / cancelled. warehouse_id is where reservations draw
// from (defaults to the org default at release); project_id is the demand
// source. plan_number SUP- (0097). Release / cancel are RPCs, not table writes.
// ---------------------------------------------------------------------------

export const SupplyPlanStatusSchema = z.enum([
  'draft',
  'released',
  'fulfilled',
  'cancelled',
]);
export type SupplyPlanStatus = z.infer<typeof SupplyPlanStatusSchema>;

export const SupplyPlanSchema = z.object({
  id: Uuid,
  org_id: Uuid,
  plan_number: z.string().nullable(),
  project_id: Uuid.nullable(),
  warehouse_id: Uuid.nullable(),
  // job_run_id (Wave 12 / A6) is the Job Run whose floor execution consumes this
  // plan's reserved stock. Set via create / patch. Nullable and optional on read:
  // the additive 0101 column never fails a parse in the deploy window before the
  // migration lands (mirrors the A4 job_template_snapshot pattern).
  job_run_id: Uuid.nullable().optional(),
  status: SupplyPlanStatusSchema,
  released_at: Iso.nullable(),
  fulfilled_at: Iso.nullable(),
  cancelled_at: Iso.nullable(),
  notes: z.string().nullable(),
  payload: z.record(z.unknown()),
  created_at: Iso,
  updated_at: Iso,
});
export type SupplyPlan = z.infer<typeof SupplyPlanSchema>;

export const SupplyPlanCreateSchema = z.object({
  project_id: Uuid.optional().nullable(),
  warehouse_id: Uuid.optional().nullable(),
  job_run_id: Uuid.optional().nullable(),
  plan_number: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  payload: z.record(z.unknown()).optional(),
});
export type SupplyPlanCreate = z.infer<typeof SupplyPlanCreateSchema>;

export const SupplyPlanPatchSchema = SupplyPlanCreateSchema.partial();
export type SupplyPlanPatch = z.infer<typeof SupplyPlanPatchSchema>;

// ---------------------------------------------------------------------------
// supply_plan_lines (child; per-item demand resolution). required / available /
// reserved / shortage are numeric (number or numeric-string on the wire); the
// release RPC fills available / reserved / shortage. resolution partitions how
// the operator covers the line; reserve is the active reserve-writing path.
// resolved_po_id / resolved_receiving_order_id are the nullable manual links.
// ---------------------------------------------------------------------------

export const SupplyPlanResolutionSchema = z.enum([
  'reserve',
  'inbound',
  'purchase',
  'replenish',
]);
export type SupplyPlanResolution = z.infer<typeof SupplyPlanResolutionSchema>;

const Qty = z.union([z.number(), z.string()]);

export const SupplyPlanLineSchema = z.object({
  id: Uuid,
  org_id: Uuid,
  supply_plan_id: Uuid,
  item_id: Uuid,
  required_qty: Qty,
  available_qty: Qty,
  reserved_qty: Qty,
  shortage_qty: Qty,
  resolution: SupplyPlanResolutionSchema,
  resolved_po_id: Uuid.nullable(),
  resolved_receiving_order_id: Uuid.nullable(),
  notes: z.string().nullable(),
  position: z.number().int(),
  created_at: Iso,
  updated_at: Iso,
});
export type SupplyPlanLine = z.infer<typeof SupplyPlanLineSchema>;

export const SupplyPlanLineCreateSchema = z.object({
  item_id: Uuid,
  required_qty: Qty.optional(),
  resolution: SupplyPlanResolutionSchema.optional(),
  resolved_po_id: Uuid.optional().nullable(),
  resolved_receiving_order_id: Uuid.optional().nullable(),
  notes: z.string().optional().nullable(),
  position: z.number().int().optional(),
});
export type SupplyPlanLineCreate = z.infer<typeof SupplyPlanLineCreateSchema>;

export const SupplyPlanLineUpdateSchema = SupplyPlanLineCreateSchema.partial();
export type SupplyPlanLineUpdate = z.infer<typeof SupplyPlanLineUpdateSchema>;

// ---------------------------------------------------------------------------
// job_runs (parent; Job Run, Phase A6; migration 0098). FSM planned /
// in_progress / completed / closed / cancelled; closed terminal. The day-by-day
// floor execution of a project. run_number JR- (0100). Transitions are RPCs
// (start / complete / close / cancel). job_template_snapshot is a frozen copy of
// the source Job Builder template, captured by the handler at run creation; its
// shape is the A4 JobTemplateSnapshotSchema (see sales.ts) but it is typed here
// as opaque jsonb (like payload) so threepl.ts stays self-contained and the
// frozen record never fails a parse on shape drift.
// ---------------------------------------------------------------------------

export const JobRunStatusSchema = z.enum([
  'planned',
  'in_progress',
  'completed',
  'closed',
  'cancelled',
]);
export type JobRunStatus = z.infer<typeof JobRunStatusSchema>;

export const JobRunSchema = z.object({
  id: Uuid,
  org_id: Uuid,
  run_number: z.string().nullable(),
  project_id: Uuid.nullable(),
  account_id: Uuid.nullable(),
  job_template_id: Uuid.nullable(),
  job_template_snapshot: z.record(z.unknown()).nullable(),
  warehouse_id: Uuid.nullable(),
  status: JobRunStatusSchema,
  started_at: Iso.nullable(),
  completed_at: Iso.nullable(),
  closed_at: Iso.nullable(),
  cancelled_at: Iso.nullable(),
  notes: z.string().nullable(),
  payload: z.record(z.unknown()),
  created_at: Iso,
  updated_at: Iso,
});
export type JobRun = z.infer<typeof JobRunSchema>;

export const JobRunCreateSchema = z.object({
  project_id: Uuid.optional().nullable(),
  account_id: Uuid.optional().nullable(),
  job_template_id: Uuid.optional().nullable(),
  warehouse_id: Uuid.optional().nullable(),
  run_number: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  payload: z.record(z.unknown()).optional(),
});
export type JobRunCreate = z.infer<typeof JobRunCreateSchema>;

export const JobRunPatchSchema = JobRunCreateSchema.partial();
export type JobRunPatch = z.infer<typeof JobRunPatchSchema>;

// ---------------------------------------------------------------------------
// job_run_daily_logs (child of job_runs; one day's work; migration 0099). FSM
// draft / posted; posting emits the consumed / produced stock_movements.
// labor_hours is numeric; labor_rate_cents is BIGINT cents (wire integer or
// numeric-string). kitforce_time_entry_id is a nullable soft link (no FK).
// ---------------------------------------------------------------------------

export const JobRunDailyLogStatusSchema = z.enum(['draft', 'posted']);
export type JobRunDailyLogStatus = z.infer<typeof JobRunDailyLogStatusSchema>;

export const JobRunDailyLogSchema = z.object({
  id: Uuid,
  org_id: Uuid,
  job_run_id: Uuid,
  log_date: Iso,
  labor_hours: Qty,
  labor_rate_cents: Cents.nullable(),
  kitforce_time_entry_id: Uuid.nullable(),
  status: JobRunDailyLogStatusSchema,
  posted_at: Iso.nullable(),
  notes: z.string().nullable(),
  created_at: Iso,
  updated_at: Iso,
});
export type JobRunDailyLog = z.infer<typeof JobRunDailyLogSchema>;

export const JobRunDailyLogCreateSchema = z.object({
  log_date: Iso.optional(),
  labor_hours: Qty.optional(),
  labor_rate_cents: Cents.optional().nullable(),
  kitforce_time_entry_id: Uuid.optional().nullable(),
  notes: z.string().optional().nullable(),
});
export type JobRunDailyLogCreate = z.infer<typeof JobRunDailyLogCreateSchema>;

export const JobRunDailyLogPatchSchema = JobRunDailyLogCreateSchema.partial();
export type JobRunDailyLogPatch = z.infer<typeof JobRunDailyLogPatchSchema>;

// ---------------------------------------------------------------------------
// job_run_daily_log line items (children of the daily log). consumed item_id is
// REQUIRED (strict consumed-side schema); produced item_id is NULLABLE (lenient
// produced-side schema). quantity is numeric; unit_cost_cents is BIGINT cents.
// ---------------------------------------------------------------------------

export const JobRunDailyLogConsumedLineSchema = z.object({
  id: Uuid,
  org_id: Uuid,
  job_run_daily_log_id: Uuid,
  item_id: Uuid,
  quantity: Qty,
  unit_cost_cents: Cents.nullable(),
  uom: z.string().nullable(),
  position: z.number().int(),
  created_at: Iso,
  updated_at: Iso,
});
export type JobRunDailyLogConsumedLine = z.infer<typeof JobRunDailyLogConsumedLineSchema>;

export const JobRunDailyLogConsumedLineCreateSchema = z.object({
  item_id: Uuid,
  quantity: Qty.optional(),
  unit_cost_cents: Cents.optional().nullable(),
  uom: z.string().min(1).max(16).optional().nullable(),
  position: z.number().int().optional(),
});
export type JobRunDailyLogConsumedLineCreate = z.infer<typeof JobRunDailyLogConsumedLineCreateSchema>;

export const JobRunDailyLogConsumedLineUpdateSchema =
  JobRunDailyLogConsumedLineCreateSchema.partial();
export type JobRunDailyLogConsumedLineUpdate = z.infer<typeof JobRunDailyLogConsumedLineUpdateSchema>;

export const JobRunDailyLogProducedLineSchema = z.object({
  id: Uuid,
  org_id: Uuid,
  job_run_daily_log_id: Uuid,
  item_id: Uuid.nullable(),
  quantity: Qty,
  unit_cost_cents: Cents.nullable(),
  uom: z.string().nullable(),
  position: z.number().int(),
  created_at: Iso,
  updated_at: Iso,
});
export type JobRunDailyLogProducedLine = z.infer<typeof JobRunDailyLogProducedLineSchema>;

export const JobRunDailyLogProducedLineCreateSchema = z.object({
  item_id: Uuid.optional().nullable(),
  quantity: Qty.optional(),
  unit_cost_cents: Cents.optional().nullable(),
  uom: z.string().min(1).max(16).optional().nullable(),
  position: z.number().int().optional(),
});
export type JobRunDailyLogProducedLineCreate = z.infer<typeof JobRunDailyLogProducedLineCreateSchema>;

export const JobRunDailyLogProducedLineUpdateSchema =
  JobRunDailyLogProducedLineCreateSchema.partial();
export type JobRunDailyLogProducedLineUpdate = z.infer<typeof JobRunDailyLogProducedLineUpdateSchema>;

// ---------------------------------------------------------------------------
// billing_reviews (parent; Billing Review, Phase A7). FSM draft / approved /
// invoiced / cancelled. The finance reconciliation surface over a completed
// Job Run: estimate_total_cents (the planned figure) against actual_total_cents
// (the realized figure) before an invoice is cut. review_number BILL- (numbering
// chassis). Approve / cancel are RPCs, not table writes; invoice_id is filled
// at approve, when the draft invoice is cut. Money is BIGINT _cents on the wire as an integer
// or numeric-string. job_run_id / project_id / account_id are the demand links.
// ---------------------------------------------------------------------------

export const BillingReviewStatusSchema = z.enum([
  'draft',
  'approved',
  'invoiced',
  'cancelled',
]);
export type BillingReviewStatus = z.infer<typeof BillingReviewStatusSchema>;

export const BillingReviewSchema = z.object({
  id: Uuid,
  org_id: Uuid,
  review_number: z.string().nullable(),
  job_run_id: Uuid.nullable(),
  project_id: Uuid.nullable(),
  account_id: Uuid.nullable(),
  invoice_id: Uuid.nullable(),
  currency_code: Currency.nullable(),
  estimate_total_cents: Cents.nullable(),
  actual_total_cents: Cents.nullable(),
  status: BillingReviewStatusSchema,
  approved_at: Iso.nullable(),
  invoiced_at: Iso.nullable(),
  cancelled_at: Iso.nullable(),
  notes: z.string().nullable(),
  payload: z.record(z.unknown()),
  created_at: Iso,
  created_by: Uuid.nullable(),
  updated_at: Iso,
  updated_by: Uuid.nullable(),
  deleted_at: Iso.nullable(),
});
export type BillingReview = z.infer<typeof BillingReviewSchema>;

export const BillingReviewCreateSchema = z.object({
  job_run_id: Uuid.optional().nullable(),
  project_id: Uuid.optional().nullable(),
  account_id: Uuid.optional().nullable(),
  review_number: z.string().optional().nullable(),
  currency_code: Currency.optional().nullable(),
  notes: z.string().optional().nullable(),
  payload: z.record(z.unknown()).optional(),
});
export type BillingReviewCreate = z.infer<typeof BillingReviewCreateSchema>;

export const BillingReviewPatchSchema = BillingReviewCreateSchema.partial();
export type BillingReviewPatch = z.infer<typeof BillingReviewPatchSchema>;

// ---------------------------------------------------------------------------
// view_job_profitability (read-only view; Job Profitability, Phase A7). One row
// per Job Run rolling estimate against realized labor and material cost and
// billed revenue. margin_cents is billed_revenue_cents minus actual_total_cents
// and CAN be negative; the Cents union already admits a leading minus.
// ---------------------------------------------------------------------------

export const JobProfitabilityRowSchema = z.object({
  org_id: Uuid,
  job_run_id: Uuid,
  project_id: Uuid.nullable(),
  account_id: Uuid.nullable(),
  estimate_total_cents: Cents,
  actual_labor_cents: Cents,
  actual_material_cents: Cents,
  actual_total_cents: Cents,
  billed_revenue_cents: Cents,
  margin_cents: Cents,
});
export type JobProfitabilityRow = z.infer<typeof JobProfitabilityRowSchema>;
