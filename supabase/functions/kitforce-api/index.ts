// kitforce-api bundle.
//
// Pillar 4 (KitForce) HTTP surface. Sibling bundle to manufacturing-api and
// copack-api; implements section 6 of
// 03-workspace/specs/kitforce-pillar-spec.md (APPROVED 2026-05-31).
//
// BUNDLE GATE: plugins.kitforce. Constitutional rule (AUDIT.md / 00-canon):
//   Bundle gate off  -> every route returns 404 NOT_FOUND envelope.
//   Per-route flag   -> 403 FEATURE_DISABLED with details.flag. (Not used here.)
//
// The gate fires BEFORE the route table so even a caller hitting an unknown
// path gets 404. Callers without an org claim land in the standard
// UNAUTHORIZED / NO_ACTIVE_ORG envelopes; we only reach the flag read once the
// caller resolves.
//
// DECIDED (A1): KitForce is a metered add-on. The bundle gates on the pillar
// flag plugins.kitforce for the 404-when-off behavior; the addons.kitforce
// entitlement is a billing-layer concern. An org without the add-on
// entitlement gets the SAME 404 NOT_FOUND envelope as a disabled pillar, so the
// gate surface is identical and no new error shape is introduced.
//
// State machines (handler-enforced, mirror the CHECK constraints from
// migrations 0078 / 0079 / 0080 and the audit-trigger guards in the same
// files). Invalid transitions are rejected with STATE_CONFLICT 409 BEFORE the
// DB call so the operator never sees a 500-class error bubble out of the status
// CHECK constraint (matches the manufacturing-api / copack-api precedent):
//   workforce_members  active <-> inactive (deactivate / reactivate).
//   shifts             scheduled -> started -> completed;
//                      scheduled|started -> cancelled; completed terminal.
//   work_assignments   open -> assigned -> in_progress -> done;
//                      open|assigned|in_progress -> cancelled; done terminal.
//   time_entries       no state machine; line-item class. A clock-out is an
//                      UPDATE that sets clock_out_at and derives minutes.
//
// C2 rate-read gate (DECIDED 2026-05-31): member labor rates are compensation
// data. default_hourly_rate_cents (workforce_members) and hourly_rate_cents
// (time_entries) are stripped from every read response UNLESS the caller's role
// is org_owner or accounting. The strip happens server-side after the row
// loads, so an ops caller (who creates and manages members, shifts, and time
// entries) never receives rate values even though the column is selected. The
// capability kitforce.member.read_rate gates the dedicated rate-read route.
//
// Capabilities (registered in _shared/capabilities.ts and the SPA mirror):
//   Reads are RLS-only; no read cap on GET. State-changing routes call
//   requireCap. RLS write policies use ('org_owner','org_admin','ops').
//
// Numbering (Decision N1, doc_types seeded by migration 0082):
//   member create     -> EMP- via nextDocNumber(org, 'workforce_member')
//   shift create      -> SHF- via nextDocNumber(org, 'shift')
//   assignment create -> WA-  via nextDocNumber(org, 'work_assignment')
//
// Routes (when plugins.kitforce is enabled for the caller's org):
//   GET    /members                              list (RLS-only)
//   POST   /members                              create (alloc EMP-)
//   GET    /members/:id                          read (RLS-only)
//   GET    /members/:id/rate                     rate-read (kitforce.member.read_rate)
//   PATCH  /members/:id                          update
//   POST   /members/:id/deactivate               active -> inactive
//   POST   /members/:id/reactivate               inactive -> active
//   GET    /teams                                list (RLS-only)
//   POST   /teams                                create
//   PATCH  /teams/:id                            update
//   GET    /teams/:id/members                    list team members
//   POST   /teams/:id/members                    add member
//   DELETE /teams/:id/members/:memberId          remove member
//   GET    /shifts                               list (filter member, status, range)
//   POST   /shifts                               create (alloc SHF-)
//   GET    /shifts/:id                           read (RLS-only)
//   PATCH  /shifts/:id                           update (scheduled only)
//   POST   /shifts/:id/start                     scheduled -> started
//   POST   /shifts/:id/complete                  started -> completed
//   POST   /shifts/:id/cancel                    -> cancelled
//   GET    /assignments                          list (filter member, job, status)
//   POST   /assignments                          create (alloc WA-)
//   GET    /assignments/:id                      read (RLS-only)
//   PATCH  /assignments/:id                      update (open only)
//   POST   /assignments/:id/assign               open -> assigned
//   POST   /assignments/:id/start                assigned -> in_progress
//   POST   /assignments/:id/complete             in_progress -> done
//   POST   /assignments/:id/cancel               -> cancelled
//   GET    /time-entries                         list (filter member, shift, range)
//   POST   /time-entries/clock-in                open a time entry
//   POST   /time-entries/:id/clock-out           close, derive minutes
//   PATCH  /time-entries/:id                     correct an entry
//   DELETE /time-entries/:id                     delete an entry

import { type Route } from '../_shared/route.ts';
import { ApiError, ok } from '../_shared/responses.ts';
import {
  admin, parseBody, parseUuidParam, respondWithIdempotency, created, requireCap,
} from '../_shared/handler-helpers.ts';
import { requireCaller, type Caller } from '../_shared/tenant.ts';
import { serveBundleWithGate } from '../_shared/bundleGate.ts';
import { nextDocNumber } from '../_shared/numbering.ts';
import { FEATURE_FLAGS } from '../_shared/constants.ts';
import {
  WorkforceMemberSchema,
  WorkforceMemberCreateSchema,
  WorkforceMemberPatchSchema,
  WorkforceTeamSchema,
  WorkforceTeamCreateSchema,
  WorkforceTeamPatchSchema,
  WorkforceTeamMemberSchema,
  WorkforceTeamMemberCreateSchema,
  ShiftSchema,
  ShiftCreateSchema,
  ShiftPatchSchema,
  WorkAssignmentSchema,
  WorkAssignmentCreateSchema,
  WorkAssignmentPatchSchema,
  TimeEntrySchema,
  TimeEntryClockInSchema,
  TimeEntryClockOutSchema,
  TimeEntryPatchSchema,
  KitForceTransitionRequestSchema,
  type WorkforceMember,
  type WorkforceMemberStatus,
  type Shift,
  type ShiftStatus,
  type WorkAssignment,
  type WorkAssignmentStatus,
  type WorkAssignmentJobType,
  type TimeEntry,
} from '../_shared/types/kitforce.ts';

const BUNDLE = 'kitforce-api';

// ---------------------------------------------------------------------------
// C2 rate-read gate. Member labor rates are compensation data; only org_owner
// and accounting may read them. The strip runs server-side AFTER the row loads
// so an ops caller never receives the value even though admin() selects the
// column. We never rely on RLS column security alone (the spec is explicit).
// ---------------------------------------------------------------------------

function canReadRate(caller: Caller): boolean {
  return caller.role === 'org_owner' || caller.role === 'accounting';
}

function stripMemberRate(caller: Caller, row: WorkforceMember): WorkforceMember {
  if (canReadRate(caller)) return row;
  return { ...row, default_hourly_rate_cents: null };
}

function stripTimeEntryRate(caller: Caller, row: TimeEntry): TimeEntry {
  if (canReadRate(caller)) return row;
  // hourly_rate_cents is NOT NULL in the schema, so it cannot be cleared to
  // null on the wire. Zero out the value for non-rate readers; the dedicated
  // rate-read path is the only way ops surfaces the real figure.
  return { ...row, hourly_rate_cents: 0 };
}

// ---------------------------------------------------------------------------
// Loaders and parent-existence probes. Cross-tenant or soft-deleted rows
// resolve to NOT_FOUND 404, matching the manufacturing-api / copack-api
// precedent.
// ---------------------------------------------------------------------------

async function loadMember(caller: Caller, id: string): Promise<WorkforceMember> {
  const { data, error } = await admin()
    .from('workforce_members').select('*')
    .eq('org_id', caller.orgId).eq('id', id).is('deleted_at', null)
    .maybeSingle();
  if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
  if (!data) throw new ApiError('NOT_FOUND', 404);
  return WorkforceMemberSchema.parse(data);
}

async function assertMemberParent(caller: Caller, id: string): Promise<void> {
  const { data, error } = await admin().from('workforce_members').select('id')
    .eq('org_id', caller.orgId).eq('id', id).is('deleted_at', null).maybeSingle();
  if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
  if (!data) throw new ApiError('NOT_FOUND', 404);
}

async function assertTeamParent(caller: Caller, id: string): Promise<void> {
  const { data, error } = await admin().from('workforce_teams').select('id')
    .eq('org_id', caller.orgId).eq('id', id).is('deleted_at', null).maybeSingle();
  if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
  if (!data) throw new ApiError('NOT_FOUND', 404);
}

async function loadShift(caller: Caller, id: string): Promise<Shift> {
  const { data, error } = await admin()
    .from('shifts').select('*')
    .eq('org_id', caller.orgId).eq('id', id).is('deleted_at', null)
    .maybeSingle();
  if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
  if (!data) throw new ApiError('NOT_FOUND', 404);
  return ShiftSchema.parse(data);
}

async function loadAssignment(caller: Caller, id: string): Promise<WorkAssignment> {
  const { data, error } = await admin()
    .from('work_assignments').select('*')
    .eq('org_id', caller.orgId).eq('id', id).is('deleted_at', null)
    .maybeSingle();
  if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
  if (!data) throw new ApiError('NOT_FOUND', 404);
  return WorkAssignmentSchema.parse(data);
}

async function loadTimeEntry(caller: Caller, id: string): Promise<TimeEntry> {
  // time_entries has no deleted_at column (hard-delete per spec section 6).
  const { data, error } = await admin()
    .from('time_entries').select('*')
    .eq('org_id', caller.orgId).eq('id', id)
    .maybeSingle();
  if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
  if (!data) throw new ApiError('NOT_FOUND', 404);
  return TimeEntrySchema.parse(data);
}

// Polymorphic job-link validation (Decision K2). The handler confirms that
// (job_type, job_id) resolves to a live, org-scoped row of the named kind
// before write; there is no DB-level FK on job_id. A miss is a VALIDATION_ERROR
// (the linked job does not exist in this org), not a NOT_FOUND on the
// assignment itself.
const JOB_TABLE_FOR_TYPE: Record<WorkAssignmentJobType, string> = {
  manufacturing_run: 'manufacturing_runs',
  kitting_job: 'kitting_jobs',
  project: 'projects',
};

async function assertJobLink(
  caller: Caller,
  jobType: WorkAssignmentJobType,
  jobId: string,
): Promise<void> {
  const table = JOB_TABLE_FOR_TYPE[jobType];
  const { data, error } = await admin().from(table).select('id')
    .eq('org_id', caller.orgId).eq('id', jobId).is('deleted_at', null)
    .maybeSingle();
  if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
  if (!data) {
    throw new ApiError(
      'VALIDATION_ERROR', 422,
      `job link does not resolve to a live ${jobType} in this org`,
      { job_type: jobType, job_id: jobId },
    );
  }
}

// ---------------------------------------------------------------------------
// State-machine guards. Reject illegal transitions BEFORE the DB call with
// STATE_CONFLICT 409 (canonical FSM-violation envelope per ERROR_CODES).
// ---------------------------------------------------------------------------

function assertMemberTransition(
  from: WorkforceMemberStatus,
  to: WorkforceMemberStatus,
): void {
  const allowed: Record<WorkforceMemberStatus, ReadonlyArray<WorkforceMemberStatus>> = {
    active: ['inactive'],
    inactive: ['active'],
  };
  if (!allowed[from].includes(to)) {
    throw new ApiError(
      'STATE_CONFLICT', 409,
      `illegal workforce_member transition: ${from} -> ${to}`,
    );
  }
}

function assertShiftTransition(from: ShiftStatus, to: ShiftStatus): void {
  const allowed: Record<ShiftStatus, ReadonlyArray<ShiftStatus>> = {
    scheduled: ['started', 'cancelled'],
    started: ['completed', 'cancelled'],
    completed: [],
    cancelled: [],
  };
  if (!allowed[from].includes(to)) {
    throw new ApiError(
      'STATE_CONFLICT', 409,
      `illegal shift transition: ${from} -> ${to}`,
    );
  }
}

function assertAssignmentTransition(
  from: WorkAssignmentStatus,
  to: WorkAssignmentStatus,
): void {
  const allowed: Record<WorkAssignmentStatus, ReadonlyArray<WorkAssignmentStatus>> = {
    open: ['assigned', 'cancelled'],
    assigned: ['in_progress', 'cancelled'],
    in_progress: ['done', 'cancelled'],
    done: [],
    cancelled: [],
  };
  if (!allowed[from].includes(to)) {
    throw new ApiError(
      'STATE_CONFLICT', 409,
      `illegal work_assignment transition: ${from} -> ${to}`,
    );
  }
}

// Derive whole-minutes-plus-fractional duration between two ISO timestamps.
// numeric(18,4) on the DB side; we compute milliseconds and divide so the
// fractional part survives. No money math here, so no roundHalfEven; the value
// is a duration, not cents.
const MS_PER_MINUTE = 60_000;

function deriveMinutes(clockInAt: string, clockOutAt: string): number {
  const inMs = Date.parse(clockInAt);
  const outMs = Date.parse(clockOutAt);
  if (!Number.isFinite(inMs) || !Number.isFinite(outMs)) {
    throw new ApiError('VALIDATION_ERROR', 422, 'unparseable clock timestamp');
  }
  if (outMs < inMs) {
    throw new ApiError(
      'STATE_CONFLICT', 409,
      'clock_out_at is before clock_in_at',
    );
  }
  // Round to 4 decimal places to match numeric(18,4) without float drift.
  return Math.round((outMs - inMs) / MS_PER_MINUTE * 10_000) / 10_000;
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Route table
// ---------------------------------------------------------------------------

const TABLE: Route[] = [
  // -------------------------------------------------------------------------
  // workforce_members (parent, state machine)
  // -------------------------------------------------------------------------
  {
    method: 'GET', path: '/members',
    handler: async ({ req, url }) => {
      const caller = requireCaller(req);
      const status = url.searchParams.get('status');
      const teamId = url.searchParams.get('team_id');
      let q = admin()
        .from('workforce_members').select('*')
        .eq('org_id', caller.orgId).is('deleted_at', null)
        .order('created_at', { ascending: false }).limit(200);
      if (status) q = q.eq('status', status);
      if (teamId) {
        // Optional team filter via the join. A cross-tenant team_id resolves
        // to an empty IN set, so the list returns 200 + [] (RLS posture).
        const { data: links, error: linkErr } = await admin()
          .from('workforce_team_members').select('member_id')
          .eq('org_id', caller.orgId).eq('team_id', teamId).is('deleted_at', null);
        if (linkErr) throw new ApiError('INTERNAL_ERROR', 500, linkErr.message);
        const ids = (links ?? []).map((r) => r.member_id as string);
        if (ids.length === 0) return ok([]);
        q = q.in('id', ids);
      }
      const { data, error } = await q;
      if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
      return ok(
        (data ?? [])
          .map((r) => WorkforceMemberSchema.parse(r))
          .map((r) => stripMemberRate(caller, r)),
      );
    },
  },
  {
    method: 'POST', path: '/members',
    handler: async ({ req }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'kitforce.member.create');
      const body = await parseBody(req, WorkforceMemberCreateSchema);
      return respondWithIdempotency(req, caller, BUNDLE, '/members', body, async () => {
        // Operator may pass a member_number to override; otherwise the
        // org-scoped numbering chassis allocates the next EMP- string (seeded
        // by migration 0082, Decision N1).
        const memberNumber = body.member_number?.trim()
          ? body.member_number.trim()
          : await nextDocNumber(caller.orgId, 'workforce_member');
        const insert: Record<string, unknown> = {
          org_id: caller.orgId,
          status: 'active',
          member_number: memberNumber,
          user_id: body.user_id ?? null,
          display_name: body.display_name,
          email: body.email ?? null,
          phone: body.phone ?? null,
          default_hourly_rate_cents: body.default_hourly_rate_cents ?? null,
          notes: body.notes ?? null,
          payload: body.payload ?? {},
          created_by: caller.userId,
          updated_by: caller.userId,
        };
        const { data, error } = await admin().from('workforce_members')
          .insert(insert).select('*').single();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        // Creator sees the figure they just set only if they may read rates.
        return created(stripMemberRate(caller, WorkforceMemberSchema.parse(data)));
      });
    },
  },
  {
    method: 'GET', path: '/members/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      parseUuidParam(params.id);
      const row = await loadMember(caller, params.id);
      return ok(stripMemberRate(caller, row));
    },
  },
  {
    // Dedicated rate-read path (C2). Gated by kitforce.member.read_rate so the
    // figure is only ever served to a caller who both holds the cap and is in
    // the org_owner / accounting role set.
    method: 'GET', path: '/members/:id/rate',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'kitforce.member.read_rate');
      parseUuidParam(params.id);
      const row = await loadMember(caller, params.id);
      return ok({
        id: row.id,
        default_hourly_rate_cents: row.default_hourly_rate_cents,
      });
    },
  },
  {
    method: 'PATCH', path: '/members/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'kitforce.member.update');
      parseUuidParam(params.id);
      const body = await parseBody(req, WorkforceMemberPatchSchema);
      return respondWithIdempotency(req, caller, BUNDLE, '/members/:id', body, async () => {
        await assertMemberParent(caller, params.id);
        const patch: Record<string, unknown> = {
          updated_by: caller.userId,
          updated_at: nowIso(),
        };
        if (body.member_number !== undefined) patch.member_number = body.member_number;
        if (body.user_id !== undefined) patch.user_id = body.user_id;
        if (body.display_name !== undefined) patch.display_name = body.display_name;
        if (body.email !== undefined) patch.email = body.email;
        if (body.phone !== undefined) patch.phone = body.phone;
        if (body.default_hourly_rate_cents !== undefined) {
          patch.default_hourly_rate_cents = body.default_hourly_rate_cents;
        }
        if (body.notes !== undefined) patch.notes = body.notes;
        if (body.payload !== undefined) patch.payload = body.payload;
        const { data, error } = await admin().from('workforce_members')
          .update(patch)
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('*').maybeSingle();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(stripMemberRate(caller, WorkforceMemberSchema.parse(data)));
      });
    },
  },
  {
    method: 'POST', path: '/members/:id/deactivate',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'kitforce.member.deactivate');
      parseUuidParam(params.id);
      const body = await parseBody(req, KitForceTransitionRequestSchema);
      return respondWithIdempotency(req, caller, BUNDLE, '/members/:id/deactivate', body, async () => {
        const cur = await loadMember(caller, params.id);
        assertMemberTransition(cur.status, 'inactive');
        const { data, error } = await admin().from('workforce_members')
          .update({
            status: 'inactive',
            updated_by: caller.userId,
            updated_at: nowIso(),
          })
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('*').maybeSingle();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(stripMemberRate(caller, WorkforceMemberSchema.parse(data)));
      });
    },
  },
  {
    method: 'POST', path: '/members/:id/reactivate',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      // Reactivation is the inverse of deactivation; reuse the deactivate cap
      // (the same role gate the lifecycle owner holds). No separate cap exists.
      requireCap(caller, 'kitforce.member.deactivate');
      parseUuidParam(params.id);
      const body = await parseBody(req, KitForceTransitionRequestSchema);
      return respondWithIdempotency(req, caller, BUNDLE, '/members/:id/reactivate', body, async () => {
        const cur = await loadMember(caller, params.id);
        assertMemberTransition(cur.status, 'active');
        const { data, error } = await admin().from('workforce_members')
          .update({
            status: 'active',
            updated_by: caller.userId,
            updated_at: nowIso(),
          })
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('*').maybeSingle();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(stripMemberRate(caller, WorkforceMemberSchema.parse(data)));
      });
    },
  },

  // -------------------------------------------------------------------------
  // workforce_teams (library, no state machine)
  // -------------------------------------------------------------------------
  {
    method: 'GET', path: '/teams',
    handler: async ({ req, url }) => {
      const caller = requireCaller(req);
      const isActive = url.searchParams.get('is_active');
      let q = admin()
        .from('workforce_teams').select('*')
        .eq('org_id', caller.orgId).is('deleted_at', null)
        .order('created_at', { ascending: false }).limit(200);
      if (isActive === 'true') q = q.eq('is_active', true);
      if (isActive === 'false') q = q.eq('is_active', false);
      const { data, error } = await q;
      if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
      return ok((data ?? []).map((r) => WorkforceTeamSchema.parse(r)));
    },
  },
  {
    method: 'POST', path: '/teams',
    handler: async ({ req }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'kitforce.team.write');
      const body = await parseBody(req, WorkforceTeamCreateSchema);
      return respondWithIdempotency(req, caller, BUNDLE, '/teams', body, async () => {
        const insert = {
          org_id: caller.orgId,
          name: body.name,
          is_active: body.is_active ?? true,
          notes: body.notes ?? null,
          payload: body.payload ?? {},
          created_by: caller.userId,
          updated_by: caller.userId,
        };
        const { data, error } = await admin().from('workforce_teams')
          .insert(insert).select('*').single();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        return created(WorkforceTeamSchema.parse(data));
      });
    },
  },
  {
    method: 'PATCH', path: '/teams/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'kitforce.team.write');
      parseUuidParam(params.id);
      const body = await parseBody(req, WorkforceTeamPatchSchema);
      return respondWithIdempotency(req, caller, BUNDLE, '/teams/:id', body, async () => {
        const patch: Record<string, unknown> = {
          updated_by: caller.userId,
          updated_at: nowIso(),
        };
        if (body.name !== undefined) patch.name = body.name;
        if (body.is_active !== undefined) patch.is_active = body.is_active;
        if (body.notes !== undefined) patch.notes = body.notes;
        if (body.payload !== undefined) patch.payload = body.payload;
        const { data, error } = await admin().from('workforce_teams')
          .update(patch)
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('*').maybeSingle();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(WorkforceTeamSchema.parse(data));
      });
    },
  },

  // -------------------------------------------------------------------------
  // workforce_team_members (join, soft-remove)
  // -------------------------------------------------------------------------
  {
    method: 'GET', path: '/teams/:id/members',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      parseUuidParam(params.id);
      await assertTeamParent(caller, params.id);
      const { data, error } = await admin()
        .from('workforce_team_members').select('*')
        .eq('org_id', caller.orgId).eq('team_id', params.id).is('deleted_at', null)
        .order('created_at', { ascending: true });
      if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
      return ok((data ?? []).map((r) => WorkforceTeamMemberSchema.parse(r)));
    },
  },
  {
    method: 'POST', path: '/teams/:id/members',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'kitforce.team.member.add');
      parseUuidParam(params.id);
      const body = await parseBody(req, WorkforceTeamMemberCreateSchema);
      return respondWithIdempotency(
        req, caller, BUNDLE, '/teams/:id/members', body,
        async () => {
          await assertTeamParent(caller, params.id);
          // The member must exist in-org and not be soft-deleted; a missing or
          // cross-tenant member resolves to NOT_FOUND 404.
          await assertMemberParent(caller, body.member_id);
          const insert = {
            org_id: caller.orgId,
            team_id: params.id,
            member_id: body.member_id,
            role_in_team: body.role_in_team ?? null,
            created_by: caller.userId,
            updated_by: caller.userId,
          };
          const { data, error } = await admin()
            .from('workforce_team_members').insert(insert)
            .select('*').single();
          if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
          return created(WorkforceTeamMemberSchema.parse(data));
        },
      );
    },
  },
  {
    method: 'DELETE', path: '/teams/:id/members/:memberId',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'kitforce.team.member.remove');
      parseUuidParam(params.id);
      parseUuidParam(params.memberId, 'memberId');
      return respondWithIdempotency(
        req, caller, BUNDLE, '/teams/:id/members/:memberId-delete', null,
        async () => {
          await assertTeamParent(caller, params.id);
          // Soft-remove: set deleted_at so the (team_id, member_id) partial
          // unique index frees up for a later re-add. Matches the join-table
          // soft-delete convention (migration 0078).
          const { data, error } = await admin()
            .from('workforce_team_members')
            .update({
              deleted_at: nowIso(),
              updated_by: caller.userId,
              updated_at: nowIso(),
            })
            .eq('org_id', caller.orgId)
            .eq('team_id', params.id)
            .eq('member_id', params.memberId)
            .is('deleted_at', null)
            .select('id').maybeSingle();
          if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
          if (!data) throw new ApiError('NOT_FOUND', 404);
          return ok({ team_id: params.id, member_id: params.memberId, removed: true });
        },
      );
    },
  },

  // -------------------------------------------------------------------------
  // shifts (parent, state machine)
  // -------------------------------------------------------------------------
  {
    method: 'GET', path: '/shifts',
    handler: async ({ req, url }) => {
      const caller = requireCaller(req);
      const status = url.searchParams.get('status');
      const memberId = url.searchParams.get('member_id');
      const teamId = url.searchParams.get('team_id');
      const warehouseId = url.searchParams.get('warehouse_id');
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      let q = admin()
        .from('shifts').select('*')
        .eq('org_id', caller.orgId).is('deleted_at', null)
        .order('scheduled_start_at', { ascending: false }).limit(200);
      if (status) q = q.eq('status', status);
      if (memberId) q = q.eq('member_id', memberId);
      if (teamId) q = q.eq('team_id', teamId);
      if (warehouseId) q = q.eq('warehouse_id', warehouseId);
      if (from) q = q.gte('scheduled_start_at', from);
      if (to) q = q.lte('scheduled_start_at', to);
      const { data, error } = await q;
      if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
      return ok((data ?? []).map((r) => ShiftSchema.parse(r)));
    },
  },
  {
    method: 'POST', path: '/shifts',
    handler: async ({ req }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'kitforce.shift.create');
      const body = await parseBody(req, ShiftCreateSchema);
      return respondWithIdempotency(req, caller, BUNDLE, '/shifts', body, async () => {
        // The rostered member must exist in-org; a missing member resolves to
        // NOT_FOUND 404 before any insert.
        await assertMemberParent(caller, body.member_id);
        // Numbering: allocate the next SHF- string (Decision N1, seeded 0082).
        // The shifts table (migration 0079) carries no shift_number column and
        // the canon ShiftSchema has no such field, so the allocated number is
        // stashed in payload.shift_number rather than a dedicated column. This
        // honors N1 without editing the numbered migration (forward-only rule)
        // and survives ShiftSchema.parse since payload is z.record(z.unknown()).
        const shiftNumber = await nextDocNumber(caller.orgId, 'shift');
        const payload = { ...(body.payload ?? {}), shift_number: shiftNumber };
        const insert: Record<string, unknown> = {
          org_id: caller.orgId,
          status: 'scheduled',
          member_id: body.member_id,
          team_id: body.team_id ?? null,
          warehouse_id: body.warehouse_id ?? null,
          scheduled_start_at: body.scheduled_start_at,
          scheduled_end_at: body.scheduled_end_at,
          notes: body.notes ?? null,
          payload,
          created_by: caller.userId,
          updated_by: caller.userId,
        };
        const { data, error } = await admin().from('shifts')
          .insert(insert).select('*').single();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        return created(ShiftSchema.parse(data));
      });
    },
  },
  {
    method: 'GET', path: '/shifts/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      parseUuidParam(params.id);
      const row = await loadShift(caller, params.id);
      return ok(row);
    },
  },
  {
    method: 'PATCH', path: '/shifts/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'kitforce.shift.update');
      parseUuidParam(params.id);
      const body = await parseBody(req, ShiftPatchSchema);
      return respondWithIdempotency(req, caller, BUNDLE, '/shifts/:id', body, async () => {
        const cur = await loadShift(caller, params.id);
        // Only scheduled shifts are editable. Once a shift has started, status
        // transitions are the only legal mutation surface.
        if (cur.status !== 'scheduled') {
          throw new ApiError(
            'STATE_CONFLICT', 409,
            `shift cannot be edited from status=${cur.status}`,
          );
        }
        if (body.member_id !== undefined && body.member_id !== null) {
          await assertMemberParent(caller, body.member_id);
        }
        const patch: Record<string, unknown> = {
          updated_by: caller.userId,
          updated_at: nowIso(),
        };
        if (body.member_id !== undefined) patch.member_id = body.member_id;
        if (body.team_id !== undefined) patch.team_id = body.team_id;
        if (body.warehouse_id !== undefined) patch.warehouse_id = body.warehouse_id;
        if (body.scheduled_start_at !== undefined) patch.scheduled_start_at = body.scheduled_start_at;
        if (body.scheduled_end_at !== undefined) patch.scheduled_end_at = body.scheduled_end_at;
        if (body.notes !== undefined) patch.notes = body.notes;
        if (body.payload !== undefined) patch.payload = body.payload;
        const { data, error } = await admin().from('shifts')
          .update(patch)
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('*').maybeSingle();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(ShiftSchema.parse(data));
      });
    },
  },
  {
    method: 'POST', path: '/shifts/:id/start',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'kitforce.shift.start');
      parseUuidParam(params.id);
      const body = await parseBody(req, KitForceTransitionRequestSchema);
      return respondWithIdempotency(req, caller, BUNDLE, '/shifts/:id/start', body, async () => {
        const cur = await loadShift(caller, params.id);
        assertShiftTransition(cur.status, 'started');
        const ts = nowIso();
        const { data, error } = await admin().from('shifts')
          .update({
            status: 'started',
            started_at: ts,
            updated_by: caller.userId,
            updated_at: ts,
          })
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('*').maybeSingle();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(ShiftSchema.parse(data));
      });
    },
  },
  {
    method: 'POST', path: '/shifts/:id/complete',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'kitforce.shift.complete');
      parseUuidParam(params.id);
      const body = await parseBody(req, KitForceTransitionRequestSchema);
      return respondWithIdempotency(req, caller, BUNDLE, '/shifts/:id/complete', body, async () => {
        const cur = await loadShift(caller, params.id);
        assertShiftTransition(cur.status, 'completed');
        const ts = nowIso();
        const { data, error } = await admin().from('shifts')
          .update({
            status: 'completed',
            completed_at: ts,
            updated_by: caller.userId,
            updated_at: ts,
          })
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('*').maybeSingle();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(ShiftSchema.parse(data));
      });
    },
  },
  {
    method: 'POST', path: '/shifts/:id/cancel',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'kitforce.shift.cancel');
      parseUuidParam(params.id);
      const body = await parseBody(req, KitForceTransitionRequestSchema);
      return respondWithIdempotency(req, caller, BUNDLE, '/shifts/:id/cancel', body, async () => {
        const cur = await loadShift(caller, params.id);
        assertShiftTransition(cur.status, 'cancelled');
        const ts = nowIso();
        const { data, error } = await admin().from('shifts')
          .update({
            status: 'cancelled',
            cancelled_at: ts,
            updated_by: caller.userId,
            updated_at: ts,
          })
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('*').maybeSingle();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(ShiftSchema.parse(data));
      });
    },
  },

  // -------------------------------------------------------------------------
  // work_assignments (parent, state machine)
  // -------------------------------------------------------------------------
  {
    method: 'GET', path: '/assignments',
    handler: async ({ req, url }) => {
      const caller = requireCaller(req);
      const status = url.searchParams.get('status');
      const memberId = url.searchParams.get('member_id');
      const shiftId = url.searchParams.get('shift_id');
      const jobType = url.searchParams.get('job_type');
      const jobId = url.searchParams.get('job_id');
      let q = admin()
        .from('work_assignments').select('*')
        .eq('org_id', caller.orgId).is('deleted_at', null)
        .order('created_at', { ascending: false }).limit(200);
      if (status) q = q.eq('status', status);
      if (memberId) q = q.eq('member_id', memberId);
      if (shiftId) q = q.eq('shift_id', shiftId);
      if (jobType) q = q.eq('job_type', jobType);
      if (jobId) q = q.eq('job_id', jobId);
      const { data, error } = await q;
      if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
      return ok((data ?? []).map((r) => WorkAssignmentSchema.parse(r)));
    },
  },
  {
    method: 'POST', path: '/assignments',
    handler: async ({ req }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'kitforce.assignment.create');
      const body = await parseBody(req, WorkAssignmentCreateSchema);
      return respondWithIdempotency(req, caller, BUNDLE, '/assignments', body, async () => {
        // Polymorphic job link (K2): both fields null or both non-null. The
        // schema allows either independently, so the handler enforces the
        // pairing and validates the linked job resolves in-org.
        const jobType = body.job_type ?? null;
        const jobId = body.job_id ?? null;
        if ((jobType === null) !== (jobId === null)) {
          throw new ApiError(
            'VALIDATION_ERROR', 422,
            'job_type and job_id must be both null or both set',
          );
        }
        if (jobType !== null && jobId !== null) {
          await assertJobLink(caller, jobType, jobId);
        }
        // If a member is named at create time, it must exist in-org.
        if (body.member_id) await assertMemberParent(caller, body.member_id);
        // Numbering: allocate the next WA- string (Decision N1, seeded 0082).
        const assignmentNumber = body.assignment_number?.trim()
          ? body.assignment_number.trim()
          : await nextDocNumber(caller.orgId, 'work_assignment');
        const insert: Record<string, unknown> = {
          org_id: caller.orgId,
          status: 'open',
          assignment_number: assignmentNumber,
          member_id: body.member_id ?? null,
          shift_id: body.shift_id ?? null,
          job_type: jobType,
          job_id: jobId,
          title: body.title,
          planned_minutes: body.planned_minutes ?? null,
          notes: body.notes ?? null,
          payload: body.payload ?? {},
          created_by: caller.userId,
          updated_by: caller.userId,
        };
        const { data, error } = await admin().from('work_assignments')
          .insert(insert).select('*').single();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        return created(WorkAssignmentSchema.parse(data));
      });
    },
  },
  {
    method: 'GET', path: '/assignments/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      parseUuidParam(params.id);
      const row = await loadAssignment(caller, params.id);
      return ok(row);
    },
  },
  {
    method: 'PATCH', path: '/assignments/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'kitforce.assignment.update');
      parseUuidParam(params.id);
      const body = await parseBody(req, WorkAssignmentPatchSchema);
      return respondWithIdempotency(req, caller, BUNDLE, '/assignments/:id', body, async () => {
        const cur = await loadAssignment(caller, params.id);
        // Only open assignments are editable. Once assigned, status
        // transitions are the only legal mutation surface.
        if (cur.status !== 'open') {
          throw new ApiError(
            'STATE_CONFLICT', 409,
            `work_assignment cannot be edited from status=${cur.status}`,
          );
        }
        // Resolve the post-patch job link to enforce the both-null-or-both-set
        // invariant against the merged state, then validate the live target.
        const nextJobType = body.job_type !== undefined ? body.job_type : cur.job_type;
        const nextJobId = body.job_id !== undefined ? body.job_id : cur.job_id;
        if ((nextJobType === null) !== (nextJobId === null)) {
          throw new ApiError(
            'VALIDATION_ERROR', 422,
            'job_type and job_id must be both null or both set',
          );
        }
        if (
          nextJobType !== null && nextJobId !== null &&
          (body.job_type !== undefined || body.job_id !== undefined)
        ) {
          await assertJobLink(caller, nextJobType, nextJobId);
        }
        if (body.member_id !== undefined && body.member_id !== null) {
          await assertMemberParent(caller, body.member_id);
        }
        const patch: Record<string, unknown> = {
          updated_by: caller.userId,
          updated_at: nowIso(),
        };
        if (body.assignment_number !== undefined) patch.assignment_number = body.assignment_number;
        if (body.member_id !== undefined) patch.member_id = body.member_id;
        if (body.shift_id !== undefined) patch.shift_id = body.shift_id;
        if (body.job_type !== undefined) patch.job_type = body.job_type;
        if (body.job_id !== undefined) patch.job_id = body.job_id;
        if (body.title !== undefined) patch.title = body.title;
        if (body.planned_minutes !== undefined) patch.planned_minutes = body.planned_minutes;
        if (body.notes !== undefined) patch.notes = body.notes;
        if (body.payload !== undefined) patch.payload = body.payload;
        const { data, error } = await admin().from('work_assignments')
          .update(patch)
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('*').maybeSingle();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(WorkAssignmentSchema.parse(data));
      });
    },
  },
  {
    method: 'POST', path: '/assignments/:id/assign',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'kitforce.assignment.assign');
      parseUuidParam(params.id);
      const body = await parseBody(req, WorkAssignmentPatchSchema);
      return respondWithIdempotency(req, caller, BUNDLE, '/assignments/:id/assign', body, async () => {
        const cur = await loadAssignment(caller, params.id);
        assertAssignmentTransition(cur.status, 'assigned');
        // The assign step may carry the member being assigned. Resolve the
        // effective member and require one to be present before advancing.
        const memberId = body.member_id !== undefined ? body.member_id : cur.member_id;
        if (!memberId) {
          throw new ApiError(
            'VALIDATION_ERROR', 422,
            'a member_id is required to assign a work_assignment',
          );
        }
        await assertMemberParent(caller, memberId);
        const ts = nowIso();
        const { data, error } = await admin().from('work_assignments')
          .update({
            status: 'assigned',
            member_id: memberId,
            updated_by: caller.userId,
            updated_at: ts,
          })
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('*').maybeSingle();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(WorkAssignmentSchema.parse(data));
      });
    },
  },
  {
    method: 'POST', path: '/assignments/:id/start',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'kitforce.assignment.start');
      parseUuidParam(params.id);
      const body = await parseBody(req, KitForceTransitionRequestSchema);
      return respondWithIdempotency(req, caller, BUNDLE, '/assignments/:id/start', body, async () => {
        const cur = await loadAssignment(caller, params.id);
        assertAssignmentTransition(cur.status, 'in_progress');
        const ts = nowIso();
        const { data, error } = await admin().from('work_assignments')
          .update({
            status: 'in_progress',
            started_at: ts,
            updated_by: caller.userId,
            updated_at: ts,
          })
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('*').maybeSingle();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(WorkAssignmentSchema.parse(data));
      });
    },
  },
  {
    method: 'POST', path: '/assignments/:id/complete',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'kitforce.assignment.complete');
      parseUuidParam(params.id);
      const body = await parseBody(req, KitForceTransitionRequestSchema);
      return respondWithIdempotency(req, caller, BUNDLE, '/assignments/:id/complete', body, async () => {
        const cur = await loadAssignment(caller, params.id);
        assertAssignmentTransition(cur.status, 'done');
        const ts = nowIso();
        const { data, error } = await admin().from('work_assignments')
          .update({
            status: 'done',
            completed_at: ts,
            updated_by: caller.userId,
            updated_at: ts,
          })
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('*').maybeSingle();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(WorkAssignmentSchema.parse(data));
      });
    },
  },
  {
    method: 'POST', path: '/assignments/:id/cancel',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'kitforce.assignment.cancel');
      parseUuidParam(params.id);
      const body = await parseBody(req, KitForceTransitionRequestSchema);
      return respondWithIdempotency(req, caller, BUNDLE, '/assignments/:id/cancel', body, async () => {
        const cur = await loadAssignment(caller, params.id);
        assertAssignmentTransition(cur.status, 'cancelled');
        const ts = nowIso();
        const { data, error } = await admin().from('work_assignments')
          .update({
            status: 'cancelled',
            cancelled_at: ts,
            updated_by: caller.userId,
            updated_at: ts,
          })
          .eq('org_id', caller.orgId).eq('id', params.id).is('deleted_at', null)
          .select('*').maybeSingle();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(WorkAssignmentSchema.parse(data));
      });
    },
  },

  // -------------------------------------------------------------------------
  // time_entries (line-item class, no parent state machine). hourly_rate_cents
  // snapshotted from the member rate at clock-in; minutes derived at clock-out.
  // Rate stripped from every read unless org_owner / accounting (C2).
  // -------------------------------------------------------------------------
  {
    method: 'GET', path: '/time-entries',
    handler: async ({ req, url }) => {
      const caller = requireCaller(req);
      const memberId = url.searchParams.get('member_id');
      const shiftId = url.searchParams.get('shift_id');
      const assignmentId = url.searchParams.get('assignment_id');
      const openOnly = url.searchParams.get('open');
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');
      let q = admin()
        .from('time_entries').select('*')
        .eq('org_id', caller.orgId)
        .order('clock_in_at', { ascending: false }).limit(200);
      if (memberId) q = q.eq('member_id', memberId);
      if (shiftId) q = q.eq('shift_id', shiftId);
      if (assignmentId) q = q.eq('assignment_id', assignmentId);
      if (openOnly === 'true') q = q.is('clock_out_at', null);
      if (from) q = q.gte('clock_in_at', from);
      if (to) q = q.lte('clock_in_at', to);
      const { data, error } = await q;
      if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
      return ok(
        (data ?? [])
          .map((r) => TimeEntrySchema.parse(r))
          .map((r) => stripTimeEntryRate(caller, r)),
      );
    },
  },
  {
    method: 'POST', path: '/time-entries/clock-in',
    handler: async ({ req }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'kitforce.time_entry.clock_in');
      const body = await parseBody(req, TimeEntryClockInSchema);
      return respondWithIdempotency(req, caller, BUNDLE, '/time-entries/clock-in', body, async () => {
        // The member must exist in-org; a missing member resolves to NOT_FOUND
        // 404 before any insert.
        await assertMemberParent(caller, body.member_id);
        // hourly_rate_cents is the rate snapshotted at clock-in. The canon
        // TimeEntryClockInSchema requires the field, so the body value is
        // authoritative and is captured verbatim onto the row. The caller is
        // expected to pass the member's current default_hourly_rate_cents; we
        // do not silently substitute a server-side value because the snapshot
        // must reflect exactly what was agreed at clock-in.
        const snapshotRate = body.hourly_rate_cents;
        const insert: Record<string, unknown> = {
          org_id: caller.orgId,
          member_id: body.member_id,
          shift_id: body.shift_id ?? null,
          assignment_id: body.assignment_id ?? null,
          clock_in_at: body.clock_in_at,
          clock_out_at: null,
          minutes: null,
          hourly_rate_cents: snapshotRate,
          notes: body.notes ?? null,
          payload: body.payload ?? {},
          created_by: caller.userId,
          updated_by: caller.userId,
        };
        const { data, error } = await admin().from('time_entries')
          .insert(insert).select('*').single();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        return created(stripTimeEntryRate(caller, TimeEntrySchema.parse(data)));
      });
    },
  },
  {
    method: 'POST', path: '/time-entries/:id/clock-out',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'kitforce.time_entry.clock_out');
      parseUuidParam(params.id);
      const body = await parseBody(req, TimeEntryClockOutSchema);
      return respondWithIdempotency(req, caller, BUNDLE, '/time-entries/:id/clock-out', body, async () => {
        const cur = await loadTimeEntry(caller, params.id);
        if (cur.clock_out_at !== null) {
          throw new ApiError(
            'STATE_CONFLICT', 409,
            'time_entry is already clocked out',
          );
        }
        // Derive minutes from the open clock_in_at to the supplied clock_out_at.
        // numeric(18,4); no float drift, no money math (duration, not cents).
        const minutes = deriveMinutes(cur.clock_in_at, body.clock_out_at);
        const { data, error } = await admin().from('time_entries')
          .update({
            clock_out_at: body.clock_out_at,
            minutes,
            updated_by: caller.userId,
            updated_at: nowIso(),
          })
          .eq('org_id', caller.orgId).eq('id', params.id)
          .select('*').maybeSingle();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(stripTimeEntryRate(caller, TimeEntrySchema.parse(data)));
      });
    },
  },
  {
    method: 'PATCH', path: '/time-entries/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'kitforce.time_entry.update');
      parseUuidParam(params.id);
      const body = await parseBody(req, TimeEntryPatchSchema);
      return respondWithIdempotency(req, caller, BUNDLE, '/time-entries/:id', body, async () => {
        const cur = await loadTimeEntry(caller, params.id);
        const patch: Record<string, unknown> = {
          updated_by: caller.userId,
          updated_at: nowIso(),
        };
        if (body.shift_id !== undefined) patch.shift_id = body.shift_id;
        if (body.assignment_id !== undefined) patch.assignment_id = body.assignment_id;
        if (body.clock_in_at !== undefined) patch.clock_in_at = body.clock_in_at;
        if (body.clock_out_at !== undefined) patch.clock_out_at = body.clock_out_at;
        // Only org_owner / accounting may set the labor rate (C2). An ops
        // correction that tries to touch the rate is rejected so compensation
        // data cannot be edited by a non-rate role.
        if (body.hourly_rate_cents !== undefined) {
          if (!canReadRate(caller)) {
            throw new ApiError(
              'FORBIDDEN', 403,
              'caller may not set time_entry hourly_rate_cents',
            );
          }
          patch.hourly_rate_cents = body.hourly_rate_cents;
        }
        if (body.notes !== undefined) patch.notes = body.notes;
        if (body.payload !== undefined) patch.payload = body.payload;
        // Recompute minutes when either clock timestamp moves and both ends are
        // known after the merge, so the derived duration stays consistent.
        const nextIn = body.clock_in_at !== undefined ? body.clock_in_at : cur.clock_in_at;
        const nextOut =
          body.clock_out_at !== undefined ? body.clock_out_at : cur.clock_out_at;
        if (
          (body.clock_in_at !== undefined || body.clock_out_at !== undefined) &&
          typeof nextIn === 'string' && typeof nextOut === 'string'
        ) {
          patch.minutes = deriveMinutes(nextIn, nextOut);
        } else if (body.clock_out_at === null) {
          // Re-opening the entry clears the derived duration.
          patch.minutes = null;
        }
        const { data, error } = await admin().from('time_entries')
          .update(patch)
          .eq('org_id', caller.orgId).eq('id', params.id)
          .select('*').maybeSingle();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok(stripTimeEntryRate(caller, TimeEntrySchema.parse(data)));
      });
    },
  },
  {
    method: 'DELETE', path: '/time-entries/:id',
    handler: async ({ req, params }) => {
      const caller = requireCaller(req);
      requireCap(caller, 'kitforce.time_entry.delete');
      parseUuidParam(params.id);
      return respondWithIdempotency(req, caller, BUNDLE, '/time-entries/:id-delete', null, async () => {
        // Hard delete: time_entries has no deleted_at column (spec section 6).
        // The DELETE audit trigger (migration 0081) captures the removal.
        const { data, error } = await admin().from('time_entries')
          .delete()
          .eq('org_id', caller.orgId).eq('id', params.id)
          .select('id').maybeSingle();
        if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
        if (!data) throw new ApiError('NOT_FOUND', 404);
        return ok({ id: params.id, deleted: true });
      });
    },
  },
];

// ---------------------------------------------------------------------------
// Bundle-level dispatcher: gate on plugins.kitforce before any route runs.
// Shared with manufacturing-api, copack-api, ops-api, etc. via
// _shared/bundleGate.ts. Gate off -> 404 NOT_FOUND for every path (A1: a
// missing addons.kitforce entitlement surfaces the same 404 at the billing
// layer; no new error shape).
// ---------------------------------------------------------------------------

serveBundleWithGate({
  flagKey: FEATURE_FLAGS.PLUGINS_KITFORCE,
  routes: TABLE,
  bundle: BUNDLE,
});
