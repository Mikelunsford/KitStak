// Job Builder type canon (ADR 0006 P2). Byte-mirror of
// apps/web/src/lib/types/jobbuilder.ts <-> supabase/functions/_shared/types/jobbuilder.ts.
// Drift is a release blocker; the contract byte-parity test asserts it.
//
// The four run-scoped build artifacts (migration 0145) hung off a job_run:
// labels with their printed data, structured scope-of-work steps, one build/ship
// timeline, and the approval jacket (a state machine). No money columns here; the
// receiving order the build flow creates is a normal receiving_orders row.

import { z } from 'zod';

export const UuidSchema = z.string().uuid();
// Postgres numeric on the wire: integer or numeric-string, never a lossy float.
export const NumericSchema = z.union([z.number(), z.string()]);

// ---------------------------------------------------------------------------
// job_run_labels
// ---------------------------------------------------------------------------

export const JobRunLabelSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  job_run_id: UuidSchema,
  label_kind: z.string(),
  size: z.string().nullable(),
  // The printed fields for this label kind (UPC code, ship-to + address, etc.).
  data: z.record(z.string()),
  qty: z.number().int().nonnegative(),
  position: z.number().int(),
});
export type JobRunLabel = z.infer<typeof JobRunLabelSchema>;

export const JobRunLabelCreateSchema = z.object({
  label_kind: z.string().min(1),
  size: z.string().nullable().optional(),
  data: z.record(z.string()).optional(),
  qty: z.number().int().nonnegative().optional(),
  position: z.number().int().optional(),
});
export type JobRunLabelCreate = z.infer<typeof JobRunLabelCreateSchema>;

export const JobRunLabelPatchSchema = JobRunLabelCreateSchema.partial();
export type JobRunLabelPatch = z.infer<typeof JobRunLabelPatchSchema>;

// ---------------------------------------------------------------------------
// job_run_sow_steps
// ---------------------------------------------------------------------------

export const JobRunSowStepSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  job_run_id: UuidSchema,
  step_no: z.number().int(),
  title: z.string(),
  detail: z.string().nullable(),
  duration_hours: NumericSchema.nullable(),
  position: z.number().int(),
});
export type JobRunSowStep = z.infer<typeof JobRunSowStepSchema>;

export const JobRunSowStepCreateSchema = z.object({
  title: z.string().min(1),
  detail: z.string().nullable().optional(),
  step_no: z.number().int().optional(),
  duration_hours: NumericSchema.nullable().optional(),
  position: z.number().int().optional(),
});
export type JobRunSowStepCreate = z.infer<typeof JobRunSowStepCreateSchema>;

export const JobRunSowStepPatchSchema = JobRunSowStepCreateSchema.partial();
export type JobRunSowStepPatch = z.infer<typeof JobRunSowStepPatchSchema>;

// ---------------------------------------------------------------------------
// job_run_timeline (one per run; planned dates plus actuals)
// ---------------------------------------------------------------------------

export const JobRunTimelineSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  job_run_id: UuidSchema,
  mabd: z.string().nullable(),
  materials_eta: z.string().nullable(),
  build_start: z.string().nullable(),
  build_end: z.string().nullable(),
  ship_date: z.string().nullable(),
  materials_received_on: z.string().nullable(),
  build_started_on: z.string().nullable(),
  build_ended_on: z.string().nullable(),
  shipped_on: z.string().nullable(),
  notes: z.string().nullable(),
});
export type JobRunTimeline = z.infer<typeof JobRunTimelineSchema>;

// Upsert/patch: every date field optional + nullable so the operator can set or
// clear one at a time. Server fills job_run_id / org_id.
export const JobRunTimelinePatchSchema = z.object({
  mabd: z.string().nullable().optional(),
  materials_eta: z.string().nullable().optional(),
  build_start: z.string().nullable().optional(),
  build_end: z.string().nullable().optional(),
  ship_date: z.string().nullable().optional(),
  materials_received_on: z.string().nullable().optional(),
  build_started_on: z.string().nullable().optional(),
  build_ended_on: z.string().nullable().optional(),
  shipped_on: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});
export type JobRunTimelinePatch = z.infer<typeof JobRunTimelinePatchSchema>;

// ---------------------------------------------------------------------------
// job_run_jacket (approval state machine)
// ---------------------------------------------------------------------------

export const JobRunJacketStatusSchema = z.enum(['draft', 'approved', 'rejected']);
export type JobRunJacketStatus = z.infer<typeof JobRunJacketStatusSchema>;

export const JobRunJacketSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  job_run_id: UuidSchema,
  status: JobRunJacketStatusSchema,
  approved_by: UuidSchema.nullable(),
  approved_at: z.string().nullable(),
  rejected_by: UuidSchema.nullable(),
  rejected_at: z.string().nullable(),
  rejection_reason: z.string().nullable(),
  snapshot: z.unknown().nullable(),
  notes: z.string().nullable(),
});
export type JobRunJacket = z.infer<typeof JobRunJacketSchema>;

// Jacket lifecycle: approve / reject / reopen. reason is required by the handler
// on reject (carried into rejection_reason); optional elsewhere.
export const JobRunJacketTransitionSchema = z.object({
  decision: z.enum(['approve', 'reject', 'reopen']),
  reason: z.string().nullable().optional(),
});
export type JobRunJacketTransition = z.infer<typeof JobRunJacketTransitionSchema>;

// ---------------------------------------------------------------------------
// build-from-quote: an approved quote becomes a buildable job. Reuses the 3PL
// chain (convert_quote_to_project -> supply_plan -> job_run -> receiving_order).
// ---------------------------------------------------------------------------

export const BuildJobFromQuoteRequestSchema = z.object({
  // Optional explicit project number; otherwise the numbering chassis allocates.
  project_number: z.string().min(1).nullable().optional(),
  // The accepted tier whose lines become the project (null for a non-tiered quote).
  tier_id: UuidSchema.nullable().optional(),
  // Auto-create a draft receiving order from the job bill of materials at build.
  // Default true (plan default: a draft RO the operator confirms).
  create_receiving_order: z.boolean().optional(),
});
export type BuildJobFromQuoteRequest = z.infer<typeof BuildJobFromQuoteRequestSchema>;

export const BuildJobFromQuoteResponseSchema = z.object({
  project_id: UuidSchema,
  job_run_id: UuidSchema,
  supply_plan_id: UuidSchema.nullable(),
  receiving_order_id: UuidSchema.nullable(),
});
export type BuildJobFromQuoteResponse = z.infer<typeof BuildJobFromQuoteResponseSchema>;
