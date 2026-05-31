import { useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import {
  useAssignmentsList,
  useMembersList,
  useCreateAssignment,
} from '@/lib/hooks/useKitForce';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import type { WorkAssignmentCreate, WorkAssignmentStatus } from '@/lib/types/kitforce';

/**
 * AssignmentsListPage. Pillar 4 work queue. Mirrors ShiftsListPage with an
 * inline create form (assignments have no dedicated create page). Supports
 * ?status= deep-links. Create gates on kitforce.assignment.create. The job link
 * is polymorphic (job_type + job_id, both null or both set); the inline form
 * keeps it simple and leaves the job link unset, since wiring a job picker
 * across three pillars is out of scope for the list surface.
 */
type StatusFilter = WorkAssignmentStatus | 'all';

const ALLOWED_ASSIGNMENT_STATUSES = new Set<string>([
  'open',
  'assigned',
  'in_progress',
  'done',
  'cancelled',
]);

function parseAssignmentStatusParam(raw: string | null): StatusFilter {
  if (raw && ALLOWED_ASSIGNMENT_STATUSES.has(raw)) {
    return raw as WorkAssignmentStatus;
  }
  return 'all';
}

export function AssignmentsListPage() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<StatusFilter>(() =>
    parseAssignmentStatusParam(searchParams.get('status')),
  );
  const [memberFilter, setMemberFilter] = useState<string>('');

  const filters = useMemo(() => {
    const f: { status?: StatusFilter; member_id?: string } = {};
    if (status !== 'all') f.status = status;
    if (memberFilter) f.member_id = memberFilter;
    return f;
  }, [status, memberFilter]);

  const assignments = useAssignmentsList(filters);
  const members = useMembersList();
  const create = useCreateAssignment();
  const caps = useVioCapabilities();
  const canCreate = caps.can('kitforce.assignment.create');

  const [title, setTitle] = useState('');
  const [memberId, setMemberId] = useState('');
  const [plannedMinutes, setPlannedMinutes] = useState('');

  const memberName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of members.data ?? []) map[m.id] = m.display_name;
    return map;
  }, [members.data]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canCreate || !title.trim()) return;
    const body: WorkAssignmentCreate = { title: title.trim() };
    if (memberId) body.member_id = memberId;
    if (plannedMinutes.trim() && /^\d+$/.test(plannedMinutes.trim())) {
      body.planned_minutes = Number(plannedMinutes.trim());
    }
    create.mutate(body, {
      onSuccess: () => {
        setTitle('');
        setMemberId('');
        setPlannedMinutes('');
      },
    });
  }

  return (
    <section className="px-8 py-12 max-w-6xl mx-auto flex flex-col gap-6">
      <header>
        <h1 className="text-4xl font-display tracking-wide text-ink">ASSIGNMENTS</h1>
      </header>

      {canCreate ? (
        <form
          onSubmit={onSubmit}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end border border-line bg-bg-2 p-4"
        >
          <div className="lg:col-span-2">
            <TextInput
              label="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>
          <label className="flex flex-col gap-1">
            <span className="font-sans text-xs text-ink-dim tracking-wide uppercase">Member (optional)</span>
            <select
              value={memberId}
              onChange={(e) => setMemberId(e.target.value)}
              disabled={members.isLoading}
              className="bg-bg-2 border border-line text-ink px-3 py-2 font-sans focus:outline-none focus:border-accent disabled:opacity-50"
            >
              <option value="">Unassigned</option>
              {(members.data ?? [])
                .filter((m) => m.status === 'active')
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.display_name}
                  </option>
                ))}
            </select>
          </label>
          <TextInput
            label="Planned minutes (optional)"
            inputMode="numeric"
            value={plannedMinutes}
            onChange={(e) => setPlannedMinutes(e.target.value)}
          />
          <Button type="submit" disabled={!title.trim() || create.isPending}>
            {create.isPending ? 'Saving.' : 'Add assignment'}
          </Button>
        </form>
      ) : null}
      {create.error ? (
        <p className="text-accent font-sans text-sm">
          {create.error instanceof Error ? create.error.message : 'Create failed.'}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-4 items-end">
        <label className="flex flex-col gap-1">
          <span className="font-sans text-xs text-ink-dim tracking-wide uppercase">Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            className="bg-bg-2 border border-line text-ink px-3 py-2 font-sans focus:outline-none focus:border-accent"
          >
            <option value="all">All</option>
            <option value="open">Open</option>
            <option value="assigned">Assigned</option>
            <option value="in_progress">In progress</option>
            <option value="done">Done</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-sans text-xs text-ink-dim tracking-wide uppercase">Member</span>
          <select
            value={memberFilter}
            onChange={(e) => setMemberFilter(e.target.value)}
            disabled={members.isLoading}
            className="bg-bg-2 border border-line text-ink px-3 py-2 font-sans focus:outline-none focus:border-accent disabled:opacity-50"
          >
            <option value="">All members</option>
            {(members.data ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.display_name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {assignments.isLoading ? <p className="text-ink-dim">Loading.</p> : null}
      {assignments.error ? (
        <p className="text-accent font-sans text-sm">
          {assignments.error instanceof Error ? assignments.error.message : 'Failed to load assignments.'}
        </p>
      ) : null}

      {!assignments.isLoading && (assignments.data ?? []).length === 0 && status === 'all' && !memberFilter ? (
        <ListEmptyState
          entity="assignment"
          explainer="Assignments are units of work you queue and route to a member. Create one to start tracking work."
          addLabel="Add assignment"
          addTo="/kitforce/assignments"
          canAdd={false}
        />
      ) : (
        <table className="w-full border border-line text-sm font-sans">
          <thead className="bg-bg-2 text-left text-ink-dim">
            <tr>
              <th className="px-4 py-2">Title</th>
              <th className="px-4 py-2">Member</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Planned min</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {(assignments.data ?? []).length === 0 && !assignments.isLoading ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-ink-dim text-sm">
                  No assignments match the current filters.
                </td>
              </tr>
            ) : (
              (assignments.data ?? []).map((a) => (
                <tr key={a.id} className="border-t border-line">
                  <td className="px-4 py-2">
                    <Link to={`/kitforce/assignments/${a.id}`} className="text-ink underline">
                      {a.title}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-ink-dim">
                    {a.member_id ? memberName[a.member_id] ?? a.member_id.slice(0, 8) : 'Unassigned'}
                  </td>
                  <td className="px-4 py-2">
                    <span className="inline-block px-2 py-0.5 border border-line text-xs font-mono uppercase text-ink-dim">
                      {a.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-ink-dim font-mono">{a.planned_minutes ?? ''}</td>
                  <td className="px-4 py-2">
                    <Link to={`/kitforce/assignments/${a.id}`} className="text-ink underline text-xs">
                      View
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      )}
    </section>
  );
}
