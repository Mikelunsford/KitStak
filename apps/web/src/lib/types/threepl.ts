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
