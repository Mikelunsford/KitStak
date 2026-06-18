# KitForce

Kitstak's fourth add-on. KitForce is the labor layer: members, teams, shifts, work assignments, and time entries.

KitForce is a paid add-on gated by the `plugins.kitforce` feature flag, which defaults off. Until an org admin enables it from `/admin/flags`, the surface renders empty and the kitforce-api returns 404 on every route.

## A note on pay rates

Pay rates are private. A member's default hourly rate and the rate on a time entry are visible only to the Owner and Accounting roles. Everyone else sees the labor records without the money. Editing a rate is restricted the same way.

## Members and teams

A member is a worker. Kitstak assigns the next member number with an `EMP-` prefix.

A member is either active or inactive. Deactivate retires a member without deleting any history; reactivate brings them back. Group members into teams, and add or remove members from a team as crews change.

## Shifts

A shift is a scheduled block of work. The lifecycle is scheduled, started, completed, cancelled. Completed and cancelled are the end of the line.

1. Click New Shift and set the member or team, the warehouse, and the planned window. Kitstak assigns the next shift number with an `SHF-` prefix.
2. You can edit a shift only while it is scheduled.
3. Start the shift when work begins, Complete it when work ends, or Cancel it if it does not run.

## Work assignments

An assignment is a unit of work handed to a member, optionally tied to a job. The lifecycle is open, assigned, in progress, done, cancelled. Done and cancelled are the end of the line.

1. Click New Assignment. You can link it to a manufacturing run, a kitting job, or a project. The link is all-or-nothing: either pick a job or leave it unlinked. Kitstak assigns the next number with a `WA-` prefix.
2. You can edit an assignment only while it is open.
3. Assign it to a member, Start it when they begin, and Complete it when they finish. Cancel is reachable from any state that is not already done or cancelled.

## Time entries

A time entry is a clock-in to clock-out span.

1. Clock in a member. Kitstak snapshots their hourly rate at that moment, so a later rate change never rewrites past hours.
2. Clock out to close the entry. Kitstak derives the minutes worked for you.
3. Correct an entry if a clock was wrong. Only Owner and Accounting can change the rate on an entry.

## Money handling

Every monetary value is stored as integer cents (BIGINT in Postgres). Rates and pay never use floating point, and the rate snapshot on a time entry is taken at clock-in.

## Audit

Every member, shift, and assignment state transition writes a row to `audit_log`.
