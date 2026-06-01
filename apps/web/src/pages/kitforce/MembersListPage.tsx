import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { useMembersList } from '@/lib/hooks/useKitForce';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { formatCents } from '@/lib/money';
import type { WorkforceMemberStatus } from '@/lib/types/kitforce';

/**
 * MembersListPage. Pillar 4 surface. Mirrors SalesOrdersListPage.
 *
 * The route is reachable today but the kitforce-api bundle gates on
 * plugins.kitforce and returns 404 for orgs without the flag. Supports ?status=
 * deep-links from the home tiles.
 *
 * C2 rate gate: the default hourly rate column only renders when the caller
 * holds kitforce.member.read_rate (org_owner, accounting). The server strips the
 * field for everyone else; the SPA mirrors that for display only and never
 * surfaces an empty rate cell to roles lacking the cap.
 */
type StatusFilter = WorkforceMemberStatus | 'all';

const ALLOWED_MEMBER_STATUSES = new Set<string>(['active', 'inactive']);

function parseMemberStatusParam(raw: string | null): StatusFilter {
  if (raw && ALLOWED_MEMBER_STATUSES.has(raw)) {
    return raw as WorkforceMemberStatus;
  }
  return 'all';
}

export function MembersListPage() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<StatusFilter>(() =>
    parseMemberStatusParam(searchParams.get('status')),
  );

  const filters = useMemo(() => {
    const f: { status?: StatusFilter } = {};
    if (status !== 'all') f.status = status;
    return f;
  }, [status]);

  const members = useMembersList(filters);
  const caps = useVioCapabilities();
  const canReadRate = caps.can('kitforce.member.read_rate');

  return (
    <section className="px-8 py-12 max-w-6xl mx-auto flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-display tracking-wide text-ink">MEMBERS</h1>
        {caps.can('kitforce.member.create') ? (
          <Link
            to="/kitforce/members/new"
            className="px-4 py-2 bg-accent text-on-primary font-sans text-sm"
          >
            New member
          </Link>
        ) : null}
      </header>

      <div className="flex flex-wrap gap-4 items-end">
        <label className="flex flex-col gap-1">
          <span className="font-sans text-xs text-ink-dim tracking-wide uppercase">Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            className="bg-bg-2 border border-line text-ink px-3 py-2 font-sans focus:outline-none focus:border-accent"
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
      </div>

      {members.isLoading ? <p className="text-ink-dim">Loading.</p> : null}
      {members.error ? (
        <p className="text-accent font-sans text-sm">
          {members.error instanceof Error ? members.error.message : 'Failed to load members.'}
        </p>
      ) : null}

      {!members.isLoading && (members.data ?? []).length === 0 && status === 'all' ? (
        <ListEmptyState
          entity="member"
          explainer="Members are the people who perform labor for your org. Add a worker to start scheduling and tracking time."
          addLabel="Add member"
          addTo="/kitforce/members/new"
          canAdd={caps.can('kitforce.member.create')}
        />
      ) : (
        <table className="w-full border border-line text-sm font-sans">
          <thead className="bg-bg-2 text-left text-ink-dim">
            <tr>
              <th className="px-4 py-2">Member</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Email</th>
              <th className="px-4 py-2">Phone</th>
              {canReadRate ? <th className="px-4 py-2">Default rate</th> : null}
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {(members.data ?? []).length === 0 && !members.isLoading ? (
              <tr>
                <td colSpan={canReadRate ? 6 : 5} className="px-4 py-6 text-ink-dim text-sm">
                  No members match the current filters.
                </td>
              </tr>
            ) : (
              (members.data ?? []).map((m) => (
                <tr key={m.id} className="border-t border-line">
                  <td className="px-4 py-2">
                    <Link to={`/kitforce/members/${m.id}`} className="text-ink underline">
                      {m.display_name}
                    </Link>
                    {m.member_number ? (
                      <span className="text-ink-dim text-xs font-mono ml-2">{m.member_number}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2">
                    <span className="inline-block px-2 py-0.5 border border-line text-xs font-mono uppercase text-ink-dim">
                      {m.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-ink-dim">{m.email ?? '·'}</td>
                  <td className="px-4 py-2 text-ink-dim">{m.phone ?? '·'}</td>
                  {canReadRate ? (
                    <td className="px-4 py-2 text-ink-dim font-mono">
                      {m.default_hourly_rate_cents != null
                        ? `${formatCents(m.default_hourly_rate_cents, 'USD')}/hr`
                        : '·'}
                    </td>
                  ) : null}
                  <td className="px-4 py-2">
                    <Link to={`/kitforce/members/${m.id}`} className="text-ink underline text-xs">
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
