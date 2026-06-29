// Estimate Engine type canon (ADR 0006, P1b). Byte-mirror of
// apps/web/src/lib/types/estimate.ts <-> supabase/functions/_shared/types/estimate.ts.
// Drift is a release blocker; the contract byte-parity test asserts it.
//
// Money model: rate-card rates are rate_micros (BIGINT, millionths of a currency
// unit) so the sub-cent per-unit rates the estimator needs survive precisely;
// estimate snapshot totals are BIGINT cents. The wire accepts integer or
// numeric-string for both so a BigInt round-trips without lossy float coercion.
// No float reaches a money field.

import { z } from 'zod';

export const CentsSchema = z.union([
  z.number().int(),
  z.string().regex(/^-?\d+$/),
]);
// rate_micros: non-negative BIGINT in millionths of a currency unit.
export const MicrosSchema = z.union([
  z.number().int().min(0),
  z.string().regex(/^\d+$/),
]);
export const UuidSchema = z.string().uuid();

// ---------------------------------------------------------------------------
// rate_cards + rate_card_lines (the Estimate Engine's pricing source)
// ---------------------------------------------------------------------------

export const RateCardStatusSchema = z.enum(['active', 'inactive']);
export type RateCardStatus = z.infer<typeof RateCardStatusSchema>;

export const RateCardSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  name: z.string(),
  currency_code: z.string().length(3),
  is_default: z.boolean(),
  status: RateCardStatusSchema,
  notes: z.string().nullable(),
});
export type RateCard = z.infer<typeof RateCardSchema>;

export const RateCardCreateSchema = z.object({
  name: z.string().min(1),
  currency_code: z.string().length(3).default('USD'),
  is_default: z.boolean().optional(),
  status: RateCardStatusSchema.optional(),
  notes: z.string().nullable().optional(),
});
export type RateCardCreate = z.infer<typeof RateCardCreateSchema>;

export const RateCardPatchSchema = RateCardCreateSchema.partial();
export type RateCardPatch = z.infer<typeof RateCardPatchSchema>;

export const RateCardLineSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  rate_card_id: UuidSchema,
  code: z.string(),
  group_key: z.string(),
  label: z.string(),
  rate_micros: MicrosSchema,
  uom: z.string().nullable(),
  position: z.number().int(),
});
export type RateCardLine = z.infer<typeof RateCardLineSchema>;

export const RateCardLineCreateSchema = z.object({
  code: z.string().min(1),
  group_key: z.string().min(1).default('constants'),
  label: z.string().min(1),
  rate_micros: MicrosSchema.default(0),
  uom: z.string().nullable().optional(),
  position: z.number().int().optional(),
});
export type RateCardLineCreate = z.infer<typeof RateCardLineCreateSchema>;

export const RateCardLinePatchSchema = RateCardLineCreateSchema.partial();
export type RateCardLinePatch = z.infer<typeof RateCardLinePatchSchema>;

// ---------------------------------------------------------------------------
// estimates (a saved draft estimate that converts into a quote)
// ---------------------------------------------------------------------------

// The family taxonomy and the pricing engine each family uses. Mirrors the pure
// config in lib/estimate/families.ts; declared here as the wire contract so the
// API validates a family/engine without importing the pricing core.
export const EstimateFamilySchema = z.enum([
  'display', 'copack', 'kitting', 'fulfillment', 'warehousing', 'valueadd', 'admin',
  // Manufacturing pillar (ADR 0006 P3). estimates.family is free text (no DB
  // check), so widening this wire enum needs no migration.
  'mfg_production', 'mfg_assembly', 'mfg_machining', 'mfg_finishing', 'mfg_shop',
]);
export type EstimateFamily = z.infer<typeof EstimateFamilySchema>;

export const EstimateEngineSchema = z.enum([
  'timestudy', 'touch', 'perpiece', 'menu', 'flat',
]);
export type EstimateEngineKind = z.infer<typeof EstimateEngineSchema>;

export const InboundModeSchema = z.enum(['pallet', 'case', 'case_heavy']);
export type InboundMode = z.infer<typeof InboundModeSchema>;

export const PalletGradeSchema = z.enum(['a', 'b']);
export type PalletGrade = z.infer<typeof PalletGradeSchema>;

// The pricing inputs the engine consumes (lib/estimate/engine.ts EstimateInput,
// minus family/engine which are estimate columns). Every numeric field defaults
// so a partial inputs jsonb still computes; the per-piece base rate is micros.
export const EstimateInputsSchema = z.object({
  qty: z.number().nonnegative().default(0),
  studyMin: z.number().nonnegative().default(0),
  studySec: z.number().nonnegative().default(0),
  inflationPct: z.number().nonnegative().default(0),
  markup: z.number().nonnegative().default(0),
  touches: z.number().nonnegative().default(0),
  baseRateMicros: z.number().nonnegative().default(0),
  inboundPallets: z.number().nonnegative().default(0),
  inboundMode: InboundModeSchema.default('pallet'),
  palletsOut: z.number().nonnegative().default(0),
  palletGrade: PalletGradeSchema.default('a'),
  labelQty: z.number().nonnegative().default(0),
  storagePallets: z.number().nonnegative().default(0),
  storageMonths: z.number().nonnegative().default(0),
  ecomOrders: z.number().nonnegative().default(0),
  ecomPieces: z.number().nonnegative().default(0),
  programmingHrs: z.number().nonnegative().default(0),
  shopHours: z.number().nonnegative().default(0),
  setupOn: z.boolean().default(false),
});
export type EstimateInputs = z.infer<typeof EstimateInputsSchema>;

export const EstimateStatusSchema = z.enum(['draft', 'converted', 'cancelled']);
export type EstimateStatus = z.infer<typeof EstimateStatusSchema>;

export const EstimateSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  number: z.string().nullable(),
  name: z.string(),
  customer_id: UuidSchema.nullable(),
  rate_card_id: UuidSchema.nullable(),
  family: EstimateFamilySchema,
  engine: EstimateEngineSchema,
  currency_code: z.string().length(3),
  status: EstimateStatusSchema,
  inputs: EstimateInputsSchema,
  subtotal_cents: CentsSchema,
  total_cents: CentsSchema,
  min_applied: z.boolean(),
  converted_to_quote_id: UuidSchema.nullable(),
  converted_at: z.string().nullable(),
  cancelled_at: z.string().nullable(),
  notes: z.string().nullable(),
});
export type Estimate = z.infer<typeof EstimateSchema>;

export const CreateEstimateRequestSchema = z.object({
  name: z.string().min(1),
  customer_id: UuidSchema.nullable().optional(),
  rate_card_id: UuidSchema.nullable().optional(),
  family: EstimateFamilySchema,
  // Optional: the handler resolves the family's default engine when omitted.
  engine: EstimateEngineSchema.optional(),
  currency_code: z.string().length(3).default('USD'),
  inputs: EstimateInputsSchema.partial().optional(),
  notes: z.string().nullable().optional(),
});
export type CreateEstimateRequest = z.infer<typeof CreateEstimateRequestSchema>;

export const UpdateEstimateRequestSchema = z.object({
  name: z.string().min(1).optional(),
  customer_id: UuidSchema.nullable().optional(),
  rate_card_id: UuidSchema.nullable().optional(),
  family: EstimateFamilySchema.optional(),
  engine: EstimateEngineSchema.optional(),
  currency_code: z.string().length(3).optional(),
  inputs: EstimateInputsSchema.partial().optional(),
  notes: z.string().nullable().optional(),
});
export type UpdateEstimateRequest = z.infer<typeof UpdateEstimateRequestSchema>;

export const ConvertEstimateRequestSchema = z.object({
  // Optional override for the produced quote's title; defaults to the estimate name.
  title: z.string().min(1).nullable().optional(),
  // Optional explicit quote number; otherwise the numbering chassis allocates it.
  number: z.string().min(1).nullable().optional(),
});
export type ConvertEstimateRequest = z.infer<typeof ConvertEstimateRequestSchema>;

// The computed estimate result the detail endpoint returns alongside the row.
// Cents are integers. Mirrors lib/estimate/engine.ts EstimateResult; server-
// authored and never validated on input (response shape only).
export const EstimateLineItemSchema = z.object({
  label: z.string(),
  detail: z.string(),
  amount_cents: z.number().int(),
});
export type EstimateLineItemDto = z.infer<typeof EstimateLineItemSchema>;

export const EstimateResultSchema = z.object({
  production_items: z.array(EstimateLineItemSchema),
  pass_through_items: z.array(EstimateLineItemSchema),
  production_cents: z.number().int(),
  pass_through_cents: z.number().int(),
  raw_cents: z.number().int(),
  total_cents: z.number().int(),
  min_applied: z.boolean(),
  has_production: z.boolean(),
  margin_ok: z.boolean(),
});
export type EstimateResultDto = z.infer<typeof EstimateResultSchema>;
