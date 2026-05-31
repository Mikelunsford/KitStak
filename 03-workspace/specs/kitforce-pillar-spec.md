# Pillar 4: KitForce. Domain spec (draft for approval)

Status: APPROVED. Operator resolved all open decisions 2026-05-31. Ready for
implementation. Ships after the Co-Pack pillar.
Date: 2026-05-31
Author: build agent
Feature flag: `plugins.kitforce` (already defined in `apps/web/src/lib/constants.ts`
and `_shared/constants.ts`). A paid add-on flag `addons.kitforce` also exists; see
Open decision A1 for how the two relate.

This spec describes the smallest coherent KitForce surface that ships value to the
first operator. It follows the established chassis exactly: Pattern A RLS from table
creation, BIGINT `_cents` money, `numeric(18,4)` quantities, status text plus CHECK
constraint state machines, append-only audit triggers, a bundle-gated edge function
that returns 404 when the pillar flag is off, and a lazy-loaded SPA pillar mirror.
Nothing here introduces a new architectural pattern. Where a real design decision
exists, it is called out under Open decisions rather than resolved unilaterally.

## 1. What this pillar is for

KitForce is labor. The operator staffs a warehouse or production floor with workers,
groups them into teams, schedules shifts, assigns work, and tracks the time spent so
labor can be costed against the jobs it served. Pillar 4 gives the operator a single
place to define the workforce, put people on a schedule, hand them tasks tied to real
work (a manufacturing run, a kitting job, a project), and capture clocked time.

KitForce is the labor-cost feeder for KitCost. Time entries carry an `hourly_rate_cents`
snapshot so labor cost rolls up the same way component and material cost already does.

## 2. Scope

In scope for Phase 1:

- A workforce registry: members (the people) and teams (groupings of people).
- A schedule: shifts a member is rostered to work.
- Work assignments: discrete tasks handed to a member, optionally linked to the job
  they serve (a manufacturing run, a kitting job, or a project).
- Time tracking: clock-in / clock-out time entries with a snapshotted labor rate,
  optionally tied to an assignment.

Deferred (not in Phase 1, listed so the boundary is explicit):

- Payroll export, tax, and pay-run processing. Phase 1 records hours and a rate; it
  does not run payroll.
- Geofencing, biometric, or hardware time-clock integrations. Phase 1 clock events are
  entered or imported, not device-driven.
- PTO, leave balances, and accrual.
- Skills, certifications, and competency-based assignment routing.
- Labor forecasting and auto-scheduling. Phase 1 shifts are placed by hand.

## 3. Entities and state machines

All tables are org-scoped with denormalized `org_id` for Pattern A RLS, carry the
standard `created_at / created_by / updated_at / updated_by` columns, and (for parents)
`deleted_at` for soft delete. Quantities and durations are `numeric(18,4)`. Money is
BIGINT `_cents`.

### 3.1 `workforce_members` (parent, state machine)

A person who performs labor for the org. Not an auth user. A member may optionally link
to a `users` row when the worker also logs into Kitstak, but the common case is a
floor worker with no login.

- `id`, `org_id`
- `member_number` text nullable, org-scoped partial unique index (mirrors
  `manufacturing_runs.run_number`), filled by the numbering chassis (`nextDocNumber`).
- `user_id` uuid references `users(id)`, nullable (links a member to a login when one
  exists; null for no-login floor workers)
- `display_name` text not null
- `email` text nullable
- `phone` text nullable
- `status` text not null default `active` check in (`active`, `inactive`)
- `default_hourly_rate_cents bigint` check null or >= 0 (the rate snapshotted onto new
  time entries unless overridden)
- `notes`, `payload jsonb default '{}'`
- standard audit columns

State machine:

```
active   -> inactive
inactive -> active
```

A member is never hard-deleted while time entries reference it; deactivation is the
terminal-in-practice path. Soft delete via `deleted_at` is available for mistaken
creates with no dependent rows.

### 3.2 `workforce_teams` (library)

A per-org grouping of members (a shift crew, a line, a pick team). No state machine.

- `id`, `org_id`
- `name` text not null (e.g. "Day shift line A", "Pick team 1")
- `is_active` boolean not null default true
- `notes`, `payload jsonb default '{}'`
- standard audit columns

### 3.3 `workforce_team_members` (join)

Append-and-soft-remove membership. A member can sit on more than one team.

- `id`, `org_id`, `team_id` (FK, on delete cascade), `member_id` (FK)
- `role_in_team` text nullable (e.g. "lead", "member")
- standard audit columns
- org-scoped unique index on `(team_id, member_id)` where `deleted_at is null`

### 3.4 `shifts` (parent, state machine)

A rostered block of time a member is scheduled to work.

- `id`, `org_id`
- `member_id` uuid not null references `workforce_members(id)`
- `team_id` uuid references `workforce_teams(id)`, nullable
- `warehouse_id` uuid references `warehouses(id)`, nullable
- `status` text not null default `scheduled` check in
  (`scheduled`, `started`, `completed`, `cancelled`)
- `scheduled_start_at`, `scheduled_end_at` timestamptz not null
- `started_at`, `completed_at`, `cancelled_at` timestamptz, handler-set
- `notes`, `payload jsonb default '{}'`
- standard audit columns

State machine identical in shape to `manufacturing_runs`:

```
scheduled -> started
started   -> completed
scheduled|started -> cancelled
completed -> (terminal)
```

### 3.5 `work_assignments` (parent, state machine)

A discrete task handed to a member, optionally linked to the job it serves. DECIDED
(K2): the job link is a polymorphic `(job_type, job_id)` pair rather than separate
FKs. This keeps the table narrow and lets a single assignment point at any job kind
without a schema change when new job kinds arrive. The tradeoff is no database-level
referential integrity on `job_id`; the handler validates that `job_id` resolves to a
live, org-scoped row of the named `job_type` before write.

- `id`, `org_id`
- `assignment_number` text nullable, org-scoped partial unique index
- `member_id` uuid references `workforce_members(id)`, nullable (unassigned until
  picked up)
- `shift_id` uuid references `shifts(id)`, nullable
- `job_type` text nullable check in (`manufacturing_run`, `kitting_job`, `project`)
- `job_id` uuid nullable (the id of the row named by `job_type`; both null for an
  unlinked task, both non-null together, enforced by a CHECK)
- `title` text not null
- `status` text not null default `open` check in
  (`open`, `assigned`, `in_progress`, `done`, `cancelled`)
- `planned_minutes numeric(18,4)` check null or >= 0
- `started_at`, `completed_at`, `cancelled_at` timestamptz
- `notes`, `payload jsonb default '{}'`
- standard audit columns

State machine:

```
open        -> assigned
assigned    -> in_progress
in_progress -> done
open|assigned|in_progress -> cancelled
done        -> (terminal)
```

### 3.6 `time_entries`

A clock-in / clock-out record. The labor-cost feeder. Carries a snapshotted rate so the
cost of the entry is fixed at capture time, the same way line items snapshot price.

- `id`, `org_id`
- `member_id` uuid not null references `workforce_members(id)`
- `shift_id` uuid references `shifts(id)`, nullable
- `assignment_id` uuid references `work_assignments(id)`, nullable
- `clock_in_at` timestamptz not null
- `clock_out_at` timestamptz nullable (null while the entry is open / in progress)
- `minutes numeric(18,4)` check null or >= 0 (derived on clock-out; null while open)
- `hourly_rate_cents bigint` not null check >= 0 (snapshotted from the member's
  `default_hourly_rate_cents` at clock-in, overridable)
- `notes`, `payload jsonb default '{}'`
- standard audit columns

`time_entries` has no parent state machine of its own; it is treated as a line-item-class
table (INSERT / UPDATE / DELETE audit trigger with an action verb in `to_state`). A
clock-out is an UPDATE that sets `clock_out_at` and `minutes`. Open decision T1 asks
whether labor cost should also emit a `stock_movements`-style ledger row or stay a pure
read-rollup in KitCost.

## 4. Audit log

New `entity_type` values, added by the same guarded drop-then-add CHECK extension used
in migration 0052: `workforce_member`, `workforce_team`, `workforce_team_member`,
`shift`, `work_assignment`, `time_entry`.

State-machine parents (`workforce_members`, `shifts`, `work_assignments`) get an
AFTER UPDATE OF status audit trigger (the `trg_audit_manufacturing_runs_status`
pattern). The team library, the team-member join, and `time_entries` get the
`audit_append_state_change` INSERT/UPDATE/DELETE trigger with an action verb in
`to_state`.

## 5. Capabilities

Naming follows `<domain>.<resource>.<action>`. Proposed set, registered in both
`apps/web/src/lib/capabilities.ts` and `_shared/capabilities/`:

```
kitforce.member.read
kitforce.member.read_rate
kitforce.member.create
kitforce.member.update
kitforce.member.deactivate
kitforce.team.read
kitforce.team.write
kitforce.team.member.add
kitforce.team.member.remove
kitforce.shift.read
kitforce.shift.create
kitforce.shift.update
kitforce.shift.start
kitforce.shift.complete
kitforce.shift.cancel
kitforce.assignment.read
kitforce.assignment.create
kitforce.assignment.update
kitforce.assignment.assign
kitforce.assignment.start
kitforce.assignment.complete
kitforce.assignment.cancel
kitforce.time_entry.read
kitforce.time_entry.clock_in
kitforce.time_entry.clock_out
kitforce.time_entry.update
kitforce.time_entry.delete
```

RLS write policies use `current_user_role() in ('org_owner','org_admin','ops')` for
all KitForce writes in Phase 1.

DECIDED (C2): member labor rates (`default_hourly_rate_cents`, `hourly_rate_cents`)
are compensation data and their reads are restricted to `org_owner` and `accounting`.
Implementation: the rate columns are served through a role-gated read path so that
`ops` (who creates and manages members, shifts, and time entries) never receives rate
values. The list/read endpoints omit the rate fields unless
`current_user_role() in ('org_owner','accounting')`; the SPA mirrors this for display
only, with the server as authority. A dedicated capability `kitforce.member.read_rate`
gates the rate-bearing read path.

## 6. Edge function bundle

New bundle `kitforce-api`, sibling to `manufacturing-api`, gated on `plugins.kitforce`
via `serveBundleWithGate`. Gate off returns the 404 NOT_FOUND envelope for every path.
Each state-changing route calls `requireCap`, enforces `Idempotency-Key` through
`respondWithIdempotency`, and rejects illegal FSM transitions with `STATE_CONFLICT` 409
before the DB call.

DECIDED (A1): KitForce is sold as a metered add-on, not a standard pillar. The bundle
gates on the pillar flag `plugins.kitforce` for the 404-when-off behavior, and the
add-on entitlement `addons.kitforce` is checked at the billing layer. An org without
the add-on entitlement gets the 404 NOT_FOUND envelope, same as a disabled pillar, so
the gate surface is identical and no new error shape is introduced. Metering (which
units are counted, and how usage is reported to billing) is a billing-layer concern
tracked separately from this domain spec.

Routes:

```
GET    /members                              list
POST   /members                              create
GET    /members/:id                          read
PATCH  /members/:id                          update
POST   /members/:id/deactivate               active -> inactive
POST   /members/:id/reactivate               inactive -> active
GET    /teams                                list
POST   /teams                                create
PATCH  /teams/:id                            update
GET    /teams/:id/members                    list team members
POST   /teams/:id/members                    add member
DELETE /teams/:id/members/:memberId          remove member
GET    /shifts                               list (filterable by member, date range)
POST   /shifts                               create
GET    /shifts/:id                           read
PATCH  /shifts/:id                           update (scheduled only)
POST   /shifts/:id/start                     scheduled -> started
POST   /shifts/:id/complete                  started -> completed
POST   /shifts/:id/cancel                    -> cancelled
GET    /assignments                          list (filterable by member, job, status)
POST   /assignments                          create
GET    /assignments/:id                      read
PATCH  /assignments/:id                      update (open only)
POST   /assignments/:id/assign               open -> assigned
POST   /assignments/:id/start                assigned -> in_progress
POST   /assignments/:id/complete             in_progress -> done
POST   /assignments/:id/cancel               -> cancelled
GET    /time-entries                         list (filterable by member, shift, date)
POST   /time-entries/clock-in                open a time entry
POST   /time-entries/:id/clock-out           close a time entry, derive minutes
PATCH  /time-entries/:id                      correct an entry
DELETE /time-entries/:id                      delete an entry
```

## 7. Zod canon

New entity schemas land byte-identical in `_shared/types/` and the SPA
`apps/web/src/lib/types/` mirror, asserted by `pnpm test:contract`. Money fields use the
existing `BigIntCentsSchema`. Durations use the existing quantity schema (`numeric(18,4)`
on the wire as number or string). A drift is a release blocker, same as today.

## 8. SPA wiring

- Pages under `apps/web/src/pages/kitforce/`: `KitForceHomePage`, `MembersListPage`,
  `MemberDetailPage`, `MemberCreatePage`, `TeamsListPage`, `TeamDetailPage`,
  `ShiftsListPage` (schedule view), `ShiftDetailPage`, `AssignmentsListPage`,
  `AssignmentDetailPage`, `TimeEntriesListPage`.
- Hooks in `apps/web/src/lib/hooks/useKitForce.ts` (TanStack Query, `staleTime 30_000`,
  `refetchOnWindowFocus: false`, `retry: 1`; mutations invalidate the entity key plus
  `auditLogKeys.byEntity`).
- Routes added to the flat `ROUTES` table under `/kitforce/*`. Because
  `inferPluginForPath` maps the `/kitforce` URL space, every route auto-gates on
  `plugins.kitforce` and returns NotFoundPage when off. `/new` and other literal
  segments must precede `/:id`.
- Job-mode sidebar: KitForce is a labor pillar. Members, teams, and the schedule land
  under a WORKFORCE / TEAM group; assignments and time tracking land under the MAKE and
  SHIP workflow groups beside the jobs they serve. Confirm sidebar grouping under Open
  decision S1.

## 9. Migration plan

Forward-only, numbered from the next free id (0073+ at time of writing; confirm against
`supabase/migrations/` at implementation time, and sequence after the Co-Pack pillar
migrations if both land in the same wave). Suggested split, one concern per file:

1. `NNNN_kitforce_members_teams.sql` (members, teams, team-member join, RLS, audit
   triggers, audit_log CHECK extension for the three workforce entity types).
2. `NNNN_kitforce_shifts.sql` (shifts, RLS, status audit trigger, CHECK extension for
   `shift`).
3. `NNNN_kitforce_assignments.sql` (work assignments, RLS, status audit trigger, CHECK
   extension for `work_assignment`). The job link is the polymorphic `(job_type,
   job_id)` pair (K2), so there is no `kitting_jobs` FK and no cross-pillar migration
   ordering dependency. Since Co-Pack ships first (K3), `job_type = 'kitting_job'` is a
   live target from day one.
4. `NNNN_kitforce_time_entries.sql` (time entries, RLS, line-item-class audit trigger,
   CHECK extension for `time_entry`).

Agents apply to STAGING only via Supabase MCP; the post-merge workflow ships to prod via
file-based push.

## 10. Decisions (resolved 2026-05-31)

- **A1. Plugin flag vs add-on flag.** RESOLVED: KitForce is a metered add-on. Bundle
  gates on `plugins.kitforce` (404 when off); the `addons.kitforce` entitlement is
  checked at the billing layer and a missing entitlement returns the same 404 envelope
  (section 6). Metering specifics are a billing-layer concern, tracked separately.
- **K2. Assignment job link: three FKs or polymorphic pair?** RESOLVED: polymorphic
  `(job_type, job_id)` pair (section 3.5). The handler validates that `job_id` resolves
  to a live, org-scoped row of the named `job_type` before write.
- **K3. `kitting_jobs` FK ordering.** RESOLVED: Co-Pack ships first, and the polymorphic
  pair means there is no real FK to order. `job_type = 'kitting_job'` is live from day
  one. No cross-pillar migration dependency remains.
- **T1. Labor cost ledger vs read-rollup.** RESOLVED: read-rollup. KitCost rolls up
  `minutes * hourly_rate_cents` on demand; no new labor ledger. Consistent with KitCost
  Option A (reporting only).
- **C2. Labor-rate read restriction.** RESOLVED: rate reads restricted to `org_owner`
  and `accounting`, gated by capability `kitforce.member.read_rate` (section 5).
- **S1. Sidebar grouping.** Open, non-blocking. Default for build: members, teams, and
  the schedule land under a WORKFORCE group; assignments and time tracking sit beside the
  jobs they serve. Adjustable at implementation without schema impact.
- **N1. Numbering prefixes.** `EMP-` for members, `SHF-` for shifts, `WA-` for work
  assignments, via the existing numbering chassis.

## 11. Out of scope confirmations

No change to RLS helpers, money helpers, idempotency, or audit_log hash chain. No new
top-level dependency. No floats. No 403 where 404 is constitutional. No payroll
processing, no device time clocks, no PTO accrual in Phase 1.
