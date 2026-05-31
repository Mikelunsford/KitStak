import { useMemo } from 'react';
import { Link } from 'react-router-dom';

import { useMembersList, useShiftsList, useAssignmentsList } from '@/lib/hooks/useKitForce';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';

/**
 * KitForceHomePage. Pillar 4 landing for the labor / workforce surface.
 *
 * Orients the operator with live counts of active members, scheduled shifts,
 * and open assignments, plus the primary entry points (members, teams,
 * schedule, assignments, time tracking). Gated by plugins.kitforce at the route
 * layer (requiresPlugin), so orgs without the pillar flag never render it.
 * Action tiles mirror the role policy for button hiding only. The server stays
 * the authority.
 */
export function KitForceHomePage() {
  const members = useMembersList();
  const shifts = useShiftsList();
  const assignments = useAssignmentsList();
  const caps = useVioCapabilities();

  const memberCounts = useMemo(() => {
    let active = 0;
    let inactive = 0;
    for (const m of members.data ?? []) {
      if (m.status === 'active') active += 1;
      else inactive += 1;
    }
    return { active, inactive };
  }, [members.data]);

  const scheduledShifts = useMemo(
    () => (shifts.data ?? []).filter((s) => s.status === 'scheduled').length,
    [shifts.data],
  );

  const openAssignments = useMemo(
    () => (assignments.data ?? []).filter((a) => a.status === 'open' || a.status === 'assigned').length,
    [assignments.data],
  );

  const canCreateMember = caps.can('kitforce.member.create');
  const canWriteTeam = caps.can('kitforce.team.write');
  const canCreateShift = caps.can('kitforce.shift.create');
  const canCreateAssignment = caps.can('kitforce.assignment.create');
  const canClockIn = caps.can('kitforce.time_entry.clock_in');

  return (
    <section className="px-8 py-12 max-w-6xl mx-auto flex flex-col gap-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-6xl font-display tracking-wide text-ink">KITFORCE</h1>
        <p className="font-sans text-lg text-ink-dim max-w-2xl">
          Staff the floor. Build teams, schedule shifts, hand out work, and track
          the hours so labor costs roll up against the jobs they served.
        </p>
      </header>

      <div className="flex flex-col gap-4">
        <h2 className="font-display text-2xl tracking-wide text-ink-dim">TODAY</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Link
            to="/kitforce/members?status=active"
            className="bg-bg-2 border border-line p-6 flex flex-col gap-2 hover:border-accent"
          >
            <span className="text-4xl font-display tracking-wide text-ink">
              {members.isLoading ? '.' : memberCounts.active}
            </span>
            <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
              Active members
            </span>
          </Link>
          <Link
            to="/kitforce/shifts?status=scheduled"
            className="bg-bg-2 border border-line p-6 flex flex-col gap-2 hover:border-accent"
          >
            <span className="text-4xl font-display tracking-wide text-ink">
              {shifts.isLoading ? '.' : scheduledShifts}
            </span>
            <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
              Scheduled shifts
            </span>
          </Link>
          <Link
            to="/kitforce/assignments?status=open"
            className="bg-bg-2 border border-line p-6 flex flex-col gap-2 hover:border-accent"
          >
            <span className="text-4xl font-display tracking-wide text-ink">
              {assignments.isLoading ? '.' : openAssignments}
            </span>
            <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
              Open assignments
            </span>
          </Link>
        </div>
        {members.error ? (
          <p className="font-sans text-sm text-accent">
            {members.error instanceof Error ? members.error.message : 'Failed to load workforce.'}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-4">
        <h2 className="font-display text-2xl tracking-wide text-ink-dim">WORKFORCE</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <ActionTile
            to="/kitforce/members"
            title="MEMBERS"
            body="The people who perform labor for your org."
          />
          {canCreateMember ? (
            <ActionTile
              to="/kitforce/members/new"
              title="NEW MEMBER"
              body="Add a worker to the registry."
            />
          ) : null}
          <ActionTile
            to="/kitforce/teams"
            title="TEAMS"
            body="Group members into crews, lines, and pick teams."
          />
          {canWriteTeam ? (
            <ActionTile
              to="/kitforce/teams"
              title="MANAGE TEAMS"
              body="Create teams and assign members to them."
            />
          ) : null}
          <ActionTile
            to="/kitforce/shifts"
            title="SCHEDULE"
            body="Roster members onto shifts and run the day."
          />
          {canCreateShift ? (
            <ActionTile
              to="/kitforce/shifts"
              title="NEW SHIFT"
              body="Place a member on the schedule."
            />
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <h2 className="font-display text-2xl tracking-wide text-ink-dim">WORK</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <ActionTile
            to="/kitforce/assignments"
            title="ASSIGNMENTS"
            body="Hand discrete tasks to members, tied to the jobs they serve."
          />
          {canCreateAssignment ? (
            <ActionTile
              to="/kitforce/assignments"
              title="NEW ASSIGNMENT"
              body="Open a task and link it to a run, kitting job, or project."
            />
          ) : null}
          <ActionTile
            to="/kitforce/time-entries"
            title="TIME TRACKING"
            body="Clock members in and out. Hours feed labor cost."
          />
          {canClockIn ? (
            <ActionTile
              to="/kitforce/time-entries"
              title="CLOCK IN"
              body="Open a time entry against a member and a shift."
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}

type ActionTileProps = { to: string; title: string; body: string };

function ActionTile({ to, title, body }: ActionTileProps) {
  return (
    <Link
      to={to}
      className="bg-bg-2 border border-line p-6 flex flex-col gap-3 hover:border-accent"
    >
      <h3 className="text-xl font-display tracking-wider text-ink">{title}</h3>
      <p className="font-sans text-ink-dim text-sm">{body}</p>
    </Link>
  );
}
