// Side-car canon: 3PL commercial layer Zod types (Accounts model, Phase A1).
// Byte-identical pair: apps/web/src/lib/types/threepl.ts.
// Drift is a release blocker.
//
// Tables (migration 0089): three_pl_accounts (the service-relationship layer
// over a CRM customer; status active/inactive flag, not a registered FSM) and
// account_service_definitions (the per-account Rate Card overlay). Money is
// BIGINT _cents carried on the wire as number or numeric-string.

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
