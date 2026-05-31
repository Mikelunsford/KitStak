// Side-car canon: Pillar 4 KitForce Zod types.
// Byte-identical pair: apps/web/src/lib/types/kitforce.ts.
// Drift is a release blocker.
//
// Tables (migrations NNNN+): workforce_members (parent, state machine),
// workforce_teams (library), workforce_team_members (join),
// shifts (parent, state machine), work_assignments (parent, state machine),
// time_entries (line-item class). Money is BIGINT _cents; durations are
// numeric(18,4) carried on the wire as number or numeric-string.

import { z } from 'zod';

const Uuid = z.string().uuid();
const Cents = z.union([z.number().int(), z.string().regex(/^-?\d+$/)]);
const Qty = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/)]);
const Iso = z.string();

// ---------------------------------------------------------------------------
// workforce_members (parent, state machine)
// active -> inactive; inactive -> active.
// A member is never hard-deleted while time entries reference it.
// ---------------------------------------------------------------------------

export const WorkforceMemberStatusSchema = z.enum(['active', 'inactive']);
export type WorkforceMemberStatus = z.infer<typeof WorkforceMemberStatusSchema>;

export const WorkforceMemberSchema = z.object({
  id: Uuid,
  org_id: Uuid,
  member_number: z.string().nullable(),
  user_id: Uuid.nullable(),
  display_name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  status: WorkforceMemberStatusSchema,
  default_hourly_rate_cents: Cents.nullable(),
  notes: z.string().nullable(),
  payload: z.record(z.unknown()),
  created_at: Iso,
  updated_at: Iso,
});
export type WorkforceMember = z.infer<typeof WorkforceMemberSchema>;

export const WorkforceMemberCreateSchema = z.object({
  member_number: z.string().optional().nullable(),
  user_id: Uuid.optional().nullable(),
  display_name: z.string().min(1),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  default_hourly_rate_cents: Cents.optional().nullable(),
  notes: z.string().optional().nullable(),
  payload: z.record(z.unknown()).optional(),
});
export type WorkforceMemberCreate = z.infer<typeof WorkforceMemberCreateSchema>;

export const WorkforceMemberPatchSchema = WorkforceMemberCreateSchema.partial();
export type WorkforceMemberPatch = z.infer<typeof WorkforceMemberPatchSchema>;

// ---------------------------------------------------------------------------
// workforce_teams (library, no state machine)
// ---------------------------------------------------------------------------

export const WorkforceTeamSchema = z.object({
  id: Uuid,
  org_id: Uuid,
  name: z.string(),
  is_active: z.boolean(),
  notes: z.string().nullable(),
  payload: z.record(z.unknown()),
  created_at: Iso,
  updated_at: Iso,
});
export type WorkforceTeam = z.infer<typeof WorkforceTeamSchema>;

export const WorkforceTeamCreateSchema = z.object({
  name: z.string().min(1),
  is_active: z.boolean().optional(),
  notes: z.string().optional().nullable(),
  payload: z.record(z.unknown()).optional(),
});
export type WorkforceTeamCreate = z.infer<typeof WorkforceTeamCreateSchema>;

export const WorkforceTeamPatchSchema = WorkforceTeamCreateSchema.partial();
export type WorkforceTeamPatch = z.infer<typeof WorkforceTeamPatchSchema>;

// ---------------------------------------------------------------------------
// workforce_team_members (join, soft-delete)
// ---------------------------------------------------------------------------

export const WorkforceTeamMemberSchema = z.object({
  id: Uuid,
  org_id: Uuid,
  team_id: Uuid,
  member_id: Uuid,
  role_in_team: z.string().nullable(),
  created_at: Iso,
  updated_at: Iso,
});
export type WorkforceTeamMember = z.infer<typeof WorkforceTeamMemberSchema>;

export const WorkforceTeamMemberCreateSchema = z.object({
  member_id: Uuid,
  role_in_team: z.string().optional().nullable(),
});
export type WorkforceTeamMemberCreate = z.infer<typeof WorkforceTeamMemberCreateSchema>;

// ---------------------------------------------------------------------------
// shifts (parent, state machine)
// scheduled -> started; started -> completed;
// scheduled|started -> cancelled; completed terminal.
// ---------------------------------------------------------------------------

export const ShiftStatusSchema = z.enum(['scheduled', 'started', 'completed', 'cancelled']);
export type ShiftStatus = z.infer<typeof ShiftStatusSchema>;

export const ShiftSchema = z.object({
  id: Uuid,
  org_id: Uuid,
  member_id: Uuid,
  team_id: Uuid.nullable(),
  warehouse_id: Uuid.nullable(),
  status: ShiftStatusSchema,
  scheduled_start_at: Iso,
  scheduled_end_at: Iso,
  started_at: Iso.nullable(),
  completed_at: Iso.nullable(),
  cancelled_at: Iso.nullable(),
  notes: z.string().nullable(),
  payload: z.record(z.unknown()),
  created_at: Iso,
  updated_at: Iso,
});
export type Shift = z.infer<typeof ShiftSchema>;

export const ShiftCreateSchema = z.object({
  member_id: Uuid,
  team_id: Uuid.optional().nullable(),
  warehouse_id: Uuid.optional().nullable(),
  scheduled_start_at: Iso,
  scheduled_end_at: Iso,
  notes: z.string().optional().nullable(),
  payload: z.record(z.unknown()).optional(),
});
export type ShiftCreate = z.infer<typeof ShiftCreateSchema>;

export const ShiftPatchSchema = ShiftCreateSchema.partial();
export type ShiftPatch = z.infer<typeof ShiftPatchSchema>;

// ---------------------------------------------------------------------------
// work_assignments (parent, state machine)
// open -> assigned -> in_progress -> done;
// open|assigned|in_progress -> cancelled; done terminal.
// Polymorphic job link: both job_type and job_id null, or both non-null.
// ---------------------------------------------------------------------------

export const WorkAssignmentJobTypeSchema = z.enum(['manufacturing_run', 'kitting_job', 'project']);
export type WorkAssignmentJobType = z.infer<typeof WorkAssignmentJobTypeSchema>;

export const WorkAssignmentStatusSchema = z.enum(['open', 'assigned', 'in_progress', 'done', 'cancelled']);
export type WorkAssignmentStatus = z.infer<typeof WorkAssignmentStatusSchema>;

export const WorkAssignmentSchema = z.object({
  id: Uuid,
  org_id: Uuid,
  assignment_number: z.string().nullable(),
  member_id: Uuid.nullable(),
  shift_id: Uuid.nullable(),
  job_type: WorkAssignmentJobTypeSchema.nullable(),
  job_id: Uuid.nullable(),
  title: z.string(),
  status: WorkAssignmentStatusSchema,
  planned_minutes: Qty.nullable(),
  started_at: Iso.nullable(),
  completed_at: Iso.nullable(),
  cancelled_at: Iso.nullable(),
  notes: z.string().nullable(),
  payload: z.record(z.unknown()),
  created_at: Iso,
  updated_at: Iso,
});
export type WorkAssignment = z.infer<typeof WorkAssignmentSchema>;

export const WorkAssignmentCreateSchema = z.object({
  assignment_number: z.string().optional().nullable(),
  member_id: Uuid.optional().nullable(),
  shift_id: Uuid.optional().nullable(),
  job_type: WorkAssignmentJobTypeSchema.optional().nullable(),
  job_id: Uuid.optional().nullable(),
  title: z.string().min(1),
  planned_minutes: Qty.optional().nullable(),
  notes: z.string().optional().nullable(),
  payload: z.record(z.unknown()).optional(),
});
export type WorkAssignmentCreate = z.infer<typeof WorkAssignmentCreateSchema>;

export const WorkAssignmentPatchSchema = WorkAssignmentCreateSchema.partial();
export type WorkAssignmentPatch = z.infer<typeof WorkAssignmentPatchSchema>;

// ---------------------------------------------------------------------------
// time_entries (line-item class, no parent state machine)
// Clock-out sets clock_out_at and derives minutes.
// hourly_rate_cents snapshotted from the member rate at clock-in.
// ---------------------------------------------------------------------------

export const TimeEntrySchema = z.object({
  id: Uuid,
  org_id: Uuid,
  member_id: Uuid,
  shift_id: Uuid.nullable(),
  assignment_id: Uuid.nullable(),
  clock_in_at: Iso,
  clock_out_at: Iso.nullable(),
  minutes: Qty.nullable(),
  hourly_rate_cents: Cents,
  notes: z.string().nullable(),
  payload: z.record(z.unknown()),
  created_at: Iso,
  updated_at: Iso,
});
export type TimeEntry = z.infer<typeof TimeEntrySchema>;

export const TimeEntryClockInSchema = z.object({
  member_id: Uuid,
  shift_id: Uuid.optional().nullable(),
  assignment_id: Uuid.optional().nullable(),
  clock_in_at: Iso,
  hourly_rate_cents: Cents,
  notes: z.string().optional().nullable(),
  payload: z.record(z.unknown()).optional(),
});
export type TimeEntryClockIn = z.infer<typeof TimeEntryClockInSchema>;

export const TimeEntryClockOutSchema = z.object({
  clock_out_at: Iso,
});
export type TimeEntryClockOut = z.infer<typeof TimeEntryClockOutSchema>;

export const TimeEntryPatchSchema = z.object({
  shift_id: Uuid.optional().nullable(),
  assignment_id: Uuid.optional().nullable(),
  clock_in_at: Iso.optional(),
  clock_out_at: Iso.optional().nullable(),
  hourly_rate_cents: Cents.optional(),
  notes: z.string().optional().nullable(),
  payload: z.record(z.unknown()).optional(),
});
export type TimeEntryPatch = z.infer<typeof TimeEntryPatchSchema>;

// ---------------------------------------------------------------------------
// Shared transition request: { reason } for start/complete/cancel/deactivate/
// reactivate/assign endpoints. The target state is fixed by the route, so only
// an optional operator reason rides the body.
// ---------------------------------------------------------------------------

export const KitForceTransitionRequestSchema = z.object({
  reason: z.string().optional().nullable(),
});
export type KitForceTransitionRequest = z.infer<typeof KitForceTransitionRequestSchema>;
