// CRM type canon. Byte-mirror of apps/web/src/lib/types/crm.ts.
// Schemas for customers, contacts, activities, leads, opportunities, plus the
// request/response shapes the crm-api bundle ships. All money in cents.
// Lead state machine and opportunity stage machine align with workflow/crm.ts.

import { z } from 'zod';

export const CrmUuidSchema = z.string().uuid();
export const CrmTimestampSchema = z.string();
export const CrmCentsSchema = z.union([
  z.number().int(),
  z.string().regex(/^-?\d+$/),
]);

export const AddressSchema = z.object({
  line1: z.string().max(200).optional(),
  line2: z.string().max(200).optional(),
  city: z.string().max(120).optional(),
  region: z.string().max(120).optional(),
  postal: z.string().max(40).optional(),
  country: z.string().max(80).optional(),
});
export type Address = z.infer<typeof AddressSchema>;

export const CustomerKindSchema = z.enum(['company', 'individual']);
export type CustomerKind = z.infer<typeof CustomerKindSchema>;

export const CustomerStatusSchema = z.enum(['new', 'active', 'inactive']);
export type CustomerStatus = z.infer<typeof CustomerStatusSchema>;

export const LeadStatusSchema = z.enum([
  'new',
  'working',
  'qualified',
  'converted',
  'disqualified',
]);
export type LeadStatus = z.infer<typeof LeadStatusSchema>;

export const LeadSourceSchema = z.enum([
  'inbound',
  'outbound',
  'referral',
  'event',
  'import',
  'other',
]);
export type LeadSource = z.infer<typeof LeadSourceSchema>;

export const OpportunityStageSchema = z.enum([
  'discovery',
  'evaluation',
  'proposal',
  'negotiation',
  'closed_won',
  'closed_lost',
]);
export type OpportunityStage = z.infer<typeof OpportunityStageSchema>;

export const ActivityKindSchema = z.enum([
  'call',
  'meeting',
  'email',
  'note',
  'task',
]);
export type ActivityKind = z.infer<typeof ActivityKindSchema>;

export const ActivityEntityTypeSchema = z.enum([
  'customer',
  'contact',
  'lead',
  'opportunity',
]);
export type ActivityEntityType = z.infer<typeof ActivityEntityTypeSchema>;

export const ActivityStatusSchema = z.enum(['open', 'completed', 'cancelled']);
export type ActivityStatus = z.infer<typeof ActivityStatusSchema>;

export const CrmListMetaSchema = z.object({
  next_cursor: z.string().nullable(),
});
export type CrmListMeta = z.infer<typeof CrmListMetaSchema>;

// -------------------------- Customers -------------------------------------

export const CustomerCreateSchema = z.object({
  display_name: z.string().min(1).max(200),
  kind: CustomerKindSchema.default('company'),
  primary_email: z.string().email().nullable().optional(),
  primary_phone: z.string().max(64).nullable().optional(),
  tax_id: z.string().max(64).nullable().optional(),
  billing_address: AddressSchema.nullable().optional(),
  shipping_address: AddressSchema.nullable().optional(),
  default_currency_code: z.string().length(3).optional(),
  default_payment_terms_days: z.number().int().nonnegative().nullable().optional(),
  tags: z.array(z.string()).default([]),
});
export type CustomerCreate = z.infer<typeof CustomerCreateSchema>;

export const CustomerPatchSchema = CustomerCreateSchema.partial();
export type CustomerPatch = z.infer<typeof CustomerPatchSchema>;

export const CustomerSchema = z.object({
  id: CrmUuidSchema,
  org_id: CrmUuidSchema,
  display_name: z.string().min(1),
  kind: CustomerKindSchema,
  status: CustomerStatusSchema,
  primary_email: z.string().nullable(),
  primary_phone: z.string().nullable(),
  tax_id: z.string().nullable(),
  billing_address: AddressSchema.nullable(),
  shipping_address: AddressSchema.nullable(),
  default_currency_code: z.string().nullable(),
  default_payment_terms_days: z.number().int().nonnegative().nullable(),
  tags: z.array(z.string()).default([]),
  created_at: CrmTimestampSchema,
  updated_at: CrmTimestampSchema,
});
export type Customer = z.infer<typeof CustomerSchema>;

// -------------------------- Contacts --------------------------------------

export const ContactCreateSchema = z.object({
  customer_id: CrmUuidSchema,
  first_name: z.string().min(1).max(80),
  last_name: z.string().max(80).nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(64).nullable().optional(),
  title: z.string().max(120).nullable().optional(),
  is_primary: z.boolean().default(false),
});
export type ContactCreate = z.infer<typeof ContactCreateSchema>;

export const ContactPatchSchema = ContactCreateSchema.partial();
export type ContactPatch = z.infer<typeof ContactPatchSchema>;

export const ContactSchema = z.object({
  id: CrmUuidSchema,
  org_id: CrmUuidSchema,
  customer_id: CrmUuidSchema,
  first_name: z.string().min(1),
  last_name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  title: z.string().nullable(),
  is_primary: z.boolean(),
  is_active: z.boolean(),
  created_at: CrmTimestampSchema,
  updated_at: CrmTimestampSchema,
});
export type Contact = z.infer<typeof ContactSchema>;

// -------------------------- Activities ------------------------------------

export const ActivityCreateSchema = z.object({
  entity_type: ActivityEntityTypeSchema,
  entity_id: CrmUuidSchema,
  kind: ActivityKindSchema,
  subject: z.string().min(1).max(200),
  body: z.string().nullable().optional(),
  due_at: CrmTimestampSchema.nullable().optional(),
  completed_at: CrmTimestampSchema.nullable().optional(),
});
export type ActivityCreate = z.infer<typeof ActivityCreateSchema>;

export const ActivityPatchSchema = z.object({
  subject: z.string().min(1).max(200).optional(),
  body: z.string().nullable().optional(),
  due_at: CrmTimestampSchema.nullable().optional(),
  completed_at: CrmTimestampSchema.nullable().optional(),
  status: ActivityStatusSchema.optional(),
});
export type ActivityPatch = z.infer<typeof ActivityPatchSchema>;

export const ActivitySchema = z.object({
  id: CrmUuidSchema,
  org_id: CrmUuidSchema,
  entity_type: ActivityEntityTypeSchema,
  entity_id: CrmUuidSchema,
  kind: ActivityKindSchema,
  subject: z.string().min(1),
  body: z.string().nullable(),
  status: ActivityStatusSchema,
  due_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  created_at: CrmTimestampSchema,
  updated_at: CrmTimestampSchema,
});
export type Activity = z.infer<typeof ActivitySchema>;

// -------------------------- Leads -----------------------------------------

export const LeadCreateSchema = z.object({
  display_name: z.string().min(1).max(200),
  company_name: z.string().max(200).nullable().optional(),
  source: LeadSourceSchema.default('inbound'),
  primary_email: z.string().email().nullable().optional(),
  primary_phone: z.string().max(64).nullable().optional(),
  owner_user_id: CrmUuidSchema.nullable().optional(),
  status: z.enum(['new', 'working', 'qualified', 'disqualified']).default('new'),
  estimated_value_cents: z.number().int().nonnegative().default(0),
  currency_code: z.string().length(3).nullable().optional(),
  notes: z.string().nullable().optional(),
});
export type LeadCreate = z.infer<typeof LeadCreateSchema>;

export const LeadPatchSchema = LeadCreateSchema.partial();
export type LeadPatch = z.infer<typeof LeadPatchSchema>;

export const LeadConvertSchema = z.object({
  create_customer: z.boolean().default(false),
  customer_id: CrmUuidSchema.nullable().optional(),
  opportunity_name: z.string().min(1).max(200),
  opportunity_amount_cents: z.number().int().nonnegative().default(0),
  opportunity_currency_code: z.string().length(3).optional(),
});
export type LeadConvert = z.infer<typeof LeadConvertSchema>;

export const LeadSchema = z.object({
  id: CrmUuidSchema,
  org_id: CrmUuidSchema,
  display_name: z.string().min(1),
  company_name: z.string().nullable(),
  source: LeadSourceSchema.nullable(),
  status: LeadStatusSchema,
  primary_email: z.string().nullable(),
  primary_phone: z.string().nullable(),
  owner_user_id: CrmUuidSchema.nullable(),
  estimated_value_cents: z.number().int().nonnegative(),
  currency_code: z.string().nullable(),
  converted_customer_id: CrmUuidSchema.nullable(),
  converted_opportunity_id: CrmUuidSchema.nullable(),
  converted_at: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: CrmTimestampSchema,
  updated_at: CrmTimestampSchema,
});
export type Lead = z.infer<typeof LeadSchema>;

export const LeadConvertResultSchema = z.object({
  lead_id: CrmUuidSchema,
  customer_id: CrmUuidSchema,
  opportunity_id: CrmUuidSchema,
});
export type LeadConvertResult = z.infer<typeof LeadConvertResultSchema>;

// -------------------------- Opportunities ---------------------------------

export const OpportunityCreateSchema = z.object({
  customer_id: CrmUuidSchema,
  lead_id: CrmUuidSchema.nullable().optional(),
  display_name: z.string().min(1).max(200),
  amount_cents: z.number().int().nonnegative().default(0),
  currency_code: z.string().length(3),
  stage: OpportunityStageSchema.default('discovery'),
  probability_pct: z.number().int().min(0).max(100).default(0),
  expected_close_date: z.string().nullable().optional(),
  owner_user_id: CrmUuidSchema.nullable().optional(),
  notes: z.string().nullable().optional(),
});
export type OpportunityCreate = z.infer<typeof OpportunityCreateSchema>;

export const OpportunityPatchSchema = OpportunityCreateSchema.partial();
export type OpportunityPatch = z.infer<typeof OpportunityPatchSchema>;

export const OpportunityStageTransitionSchema = z.object({
  stage: OpportunityStageSchema,
  close_reason: z.string().max(500).nullable().optional(),
});
export type OpportunityStageTransition = z.infer<
  typeof OpportunityStageTransitionSchema
>;

export const OpportunitySchema = z.object({
  id: CrmUuidSchema,
  org_id: CrmUuidSchema,
  customer_id: CrmUuidSchema,
  lead_id: CrmUuidSchema.nullable(),
  display_name: z.string().min(1),
  stage: OpportunityStageSchema,
  amount_cents: z.number().int().nonnegative(),
  currency_code: z.string().nullable(),
  probability_pct: z.number().int(),
  expected_close_date: z.string().nullable(),
  closed_at: z.string().nullable(),
  close_reason: z.string().nullable(),
  owner_user_id: CrmUuidSchema.nullable(),
  notes: z.string().nullable(),
  created_at: CrmTimestampSchema,
  updated_at: CrmTimestampSchema,
});
export type Opportunity = z.infer<typeof OpportunitySchema>;
