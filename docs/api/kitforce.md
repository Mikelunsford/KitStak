# KitForce API

One edge function bundle covers the KitForce add-on.

## kitforce-api

The KitForce add-on HTTP surface, the labor and scheduling layer. Every non-GET requires `Idempotency-Key` (UUID v4) and an active org claim.

### Plugin gate

The whole bundle is gated by `plugins.kitforce`. When the flag is off the bundle returns `404 NOT_FOUND` on every path, so a disabled add-on leaks no surface. KitForce is a paid add-on.

### Rate visibility

Pay rates are read-restricted. The `default_hourly_rate_cents` on a member and the `hourly_rate_cents` on a time entry are stripped from every read response unless the caller's role is `org_owner` or `accounting`. A dedicated read route exposes the rate behind its own capability.

### workforce_members

A worker. Member numbers auto-generate with the `EMP-` prefix.

- `GET /kitforce-api/members` lists members. RLS-only, filterable by `status` and `team_id`.
- `POST /kitforce-api/members` creates a member. `requireCap("kitforce.member.create")`.
- `GET /kitforce-api/members/:id` reads one member. RLS-only.
- `GET /kitforce-api/members/:id/rate` reads the member's rate. `requireCap("kitforce.member.read_rate")`, additionally gated to `org_owner` and `accounting`.
- `PATCH /kitforce-api/members/:id` updates a member. `requireCap("kitforce.member.update")`.
- `POST /kitforce-api/members/:id/deactivate` moves `active` to `inactive`. `requireCap("kitforce.member.deactivate")`.
- `POST /kitforce-api/members/:id/reactivate` moves `inactive` to `active`. `requireCap("kitforce.member.deactivate")`.

### teams

A crew or grouping of members.

- `GET /kitforce-api/teams` lists teams. RLS-only, filterable by `is_active`.
- `POST /kitforce-api/teams` creates a team. `requireCap("kitforce.team.write")`.
- `PATCH /kitforce-api/teams/:id` updates a team. `requireCap("kitforce.team.write")`.
- `GET /kitforce-api/teams/:id/members` lists a team's members. RLS-only.
- `POST /kitforce-api/teams/:id/members` adds a member to a team. `requireCap("kitforce.team.member.add")`.
- `DELETE /kitforce-api/teams/:id/members/:memberId` removes a member from a team (soft delete). `requireCap("kitforce.team.member.remove")`.

### shifts

A scheduled block of work. Shift numbers auto-generate with the `SHF-` prefix.

#### CRUD

- `GET /kitforce-api/shifts` lists shifts. RLS-only, filterable by `status`, `member_id`, `team_id`, `warehouse_id`, and a date range.
- `POST /kitforce-api/shifts` creates a shift in `scheduled`. `requireCap("kitforce.shift.create")`.
- `GET /kitforce-api/shifts/:id` reads one shift. RLS-only.
- `PATCH /kitforce-api/shifts/:id` updates a shift. Allowed only while `scheduled`. `requireCap("kitforce.shift.update")`.

#### State transitions

States: `scheduled`, `started`, `completed`, `cancelled`. `completed` and `cancelled` are terminal.

- `POST /kitforce-api/shifts/:id/start` moves `scheduled` to `started`. `requireCap("kitforce.shift.start")`.
- `POST /kitforce-api/shifts/:id/complete` moves `started` to `completed`. `requireCap("kitforce.shift.complete")`.
- `POST /kitforce-api/shifts/:id/cancel` moves a non-terminal shift to `cancelled`. `requireCap("kitforce.shift.cancel")`.

### work_assignments

A unit of work assigned to a member, optionally linked to a job. Assignment numbers auto-generate with the `WA-` prefix. The job link is polymorphic: `job_type` and `job_id` are both null or both set, and the target must be a `manufacturing_run`, a `kitting_job`, or a `project`. A mismatched or missing link returns `422 VALIDATION_ERROR`.

#### CRUD

- `GET /kitforce-api/assignments` lists assignments. RLS-only, filterable by `status`, `member_id`, `shift_id`, `job_type`, and `job_id`.
- `POST /kitforce-api/assignments` creates an assignment in `open`. `requireCap("kitforce.assignment.create")`.
- `GET /kitforce-api/assignments/:id` reads one assignment. RLS-only.
- `PATCH /kitforce-api/assignments/:id` updates an assignment. Allowed only while `open`. `requireCap("kitforce.assignment.update")`.

#### State transitions

States: `open`, `assigned`, `in_progress`, `done`, `cancelled`. `done` and `cancelled` are terminal.

- `POST /kitforce-api/assignments/:id/assign` moves `open` to `assigned`. Requires a member. `requireCap("kitforce.assignment.assign")`.
- `POST /kitforce-api/assignments/:id/start` moves `assigned` to `in_progress`. `requireCap("kitforce.assignment.start")`.
- `POST /kitforce-api/assignments/:id/complete` moves `in_progress` to `done`. `requireCap("kitforce.assignment.complete")`.
- `POST /kitforce-api/assignments/:id/cancel` moves a non-terminal assignment to `cancelled`. `requireCap("kitforce.assignment.cancel")`.

### time_entries

A clock-in to clock-out span. Not a registered state machine; a clock-out is an update that stamps `clock_out_at` and derives `minutes`.

- `GET /kitforce-api/time-entries` lists entries. RLS-only, filterable by `member_id`, `shift_id`, `assignment_id`, open status, and a date range. Rate fields are stripped unless the caller is `org_owner` or `accounting`.
- `POST /kitforce-api/time-entries/clock-in` opens an entry and snapshots the member's hourly rate at that moment. `requireCap("kitforce.time_entry.clock_in")`.
- `POST /kitforce-api/time-entries/:id/clock-out` closes the entry and derives `minutes`. `requireCap("kitforce.time_entry.clock_out")`. A clock-out before clock-in, or a second clock-out, returns `409 STATE_CONFLICT`.
- `PATCH /kitforce-api/time-entries/:id` corrects an entry. `requireCap("kitforce.time_entry.update")`. Editing `hourly_rate_cents` is restricted to `org_owner` and `accounting`; another role attempting it gets `403 FORBIDDEN`.
- `DELETE /kitforce-api/time-entries/:id` removes an entry (hard delete). `requireCap("kitforce.time_entry.delete")`.

## Error envelope

Every error response is `{ "error": { "code", "message", "details" } }` with an `x-request-id` header. Codes the bundle emits:

- `UNAUTHORIZED` (401) Authorization missing.
- `NO_ACTIVE_ORG` (401) Token has no org claim.
- `FORBIDDEN` (403) Capability denied, or a rate edit by a non-rate role.
- `NOT_FOUND` (404) Row not in caller's org, the linked job is missing, or the add-on is gated off.
- `STATE_CONFLICT` (409) Illegal transition, a clock-out before clock-in, or a double clock-out.
- `IDEMPOTENCY_CONFLICT` (409) Same key, different body.
- `VALIDATION_ERROR` (422) Body failed Zod, an unparseable clock timestamp, or a malformed job link.
