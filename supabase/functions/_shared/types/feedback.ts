// Side-car canon: internal feedback / support ticketing (operator beta
// channel).
// Byte-identical pair: supabase/functions/_shared/types/feedback.ts.
// Drift is a release blocker.
//
// Tables (migration 0140): support_tickets (org-scoped, rich status FSM:
// open -> triaged -> in_progress -> resolved -> closed, with reopen) and
// support_ticket_comments (the two-way thread; is_internal notes stay on the
// staff surface). platform_staff is a global operator allowlist read only via
// is_platform_staff(); the staff surface reads across tenants through a gated
// service-role function, never through tenant RLS. No money on these entities.

import { z } from 'zod';

const Uuid = z.string().uuid();
const Iso = z.string();

// ---------------------------------------------------------------------------
// Enums (mirror the migration 0140 CHECK constraints exactly)
// ---------------------------------------------------------------------------

export const SupportTicketTypeSchema = z.enum([
  'bug',
  'suggestion',
  'question',
]);
export type SupportTicketType = z.infer<typeof SupportTicketTypeSchema>;

export const SupportTicketStatusSchema = z.enum([
  'open',
  'triaged',
  'in_progress',
  'resolved',
  'closed',
]);
export type SupportTicketStatus = z.infer<typeof SupportTicketStatusSchema>;

export const SupportTicketPrioritySchema = z.enum([
  'low',
  'normal',
  'high',
  'urgent',
]);
export type SupportTicketPriority = z.infer<typeof SupportTicketPrioritySchema>;

export const SupportTicketAuthorKindSchema = z.enum([
  'tenant_user',
  'platform_staff',
]);
export type SupportTicketAuthorKind = z.infer<
  typeof SupportTicketAuthorKindSchema
>;

// Client-captured context attached silently on submit. Open shape: the SPA
// records what it can and the staff surface renders whatever is present.
export const SupportTicketContextSchema = z
  .object({
    route: z.string().optional(),
    app_version: z.string().optional(),
    commit: z.string().optional(),
    user_agent: z.string().optional(),
    org_name: z.string().optional(),
  })
  .passthrough();
export type SupportTicketContext = z.infer<typeof SupportTicketContextSchema>;

// ---------------------------------------------------------------------------
// support_tickets
// ---------------------------------------------------------------------------

export const SupportTicketSchema = z.object({
  id: Uuid,
  org_id: Uuid,
  reference: z.string().nullable(),
  type: SupportTicketTypeSchema,
  title: z.string(),
  body: z.string(),
  status: SupportTicketStatusSchema,
  priority: SupportTicketPrioritySchema.nullable(),
  context: SupportTicketContextSchema,
  resolved_at: Iso.nullable(),
  closed_at: Iso.nullable(),
  created_at: Iso,
  created_by: Uuid.nullable(),
  updated_at: Iso,
});
export type SupportTicket = z.infer<typeof SupportTicketSchema>;

// Staff inbox row: the cross-tenant view adds the originating org name and the
// submitter email so an operator can triage without leaving the surface.
export const SupportTicketStaffSchema = SupportTicketSchema.extend({
  org_name: z.string().nullable(),
  created_by_email: z.string().nullable(),
  comment_count: z.number().int().nonnegative(),
});
export type SupportTicketStaff = z.infer<typeof SupportTicketStaffSchema>;

// ---------------------------------------------------------------------------
// support_ticket_comments
// ---------------------------------------------------------------------------

export const SupportTicketCommentSchema = z.object({
  id: Uuid,
  ticket_id: Uuid,
  org_id: Uuid,
  author_id: Uuid.nullable(),
  author_kind: SupportTicketAuthorKindSchema,
  body: z.string(),
  is_internal: z.boolean(),
  created_at: Iso,
});
export type SupportTicketComment = z.infer<typeof SupportTicketCommentSchema>;

// ---------------------------------------------------------------------------
// Inputs: tenant side (feedback-api)
// ---------------------------------------------------------------------------

export const SupportTicketCreateSchema = z.object({
  type: SupportTicketTypeSchema,
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(10000),
  context: SupportTicketContextSchema.optional(),
});
export type SupportTicketCreateInput = z.infer<
  typeof SupportTicketCreateSchema
>;

export const SupportTicketCommentCreateSchema = z.object({
  body: z.string().min(1).max(10000),
});
export type SupportTicketCommentCreateInput = z.infer<
  typeof SupportTicketCommentCreateSchema
>;

// ---------------------------------------------------------------------------
// Inputs: staff side (feedback-admin-api, gated by is_platform_staff)
// ---------------------------------------------------------------------------

export const SupportTicketStaffUpdateSchema = z
  .object({
    status: SupportTicketStatusSchema.optional(),
    priority: SupportTicketPrioritySchema.nullable().optional(),
  })
  .refine(
    (v) => v.status !== undefined || v.priority !== undefined,
    { message: 'at least one of status or priority is required' },
  );
export type SupportTicketStaffUpdateInput = z.infer<
  typeof SupportTicketStaffUpdateSchema
>;

export const SupportTicketStaffCommentCreateSchema = z.object({
  body: z.string().min(1).max(10000),
  is_internal: z.boolean().optional(),
});
export type SupportTicketStaffCommentCreateInput = z.infer<
  typeof SupportTicketStaffCommentCreateSchema
>;
