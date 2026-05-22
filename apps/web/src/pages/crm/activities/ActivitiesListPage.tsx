import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { activitiesKeys } from '@/lib/queryKeys/activities';
import { listActivities } from '@/lib/services/activitiesService';

export function ActivitiesListPage() {
  const [status, setStatus] = useState('open');
  const filters = status ? { status } : {};
  const query = useQuery({
    queryKey: activitiesKeys.list(filters),
    queryFn: () => listActivities(filters),
    staleTime: 30_000,
  });

  return (
    <section className="px-8 py-10 max-w-6xl mx-auto flex flex-col gap-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-4xl font-display tracking-wide text-ink">
          ACTIVITIES
        </h1>
        <Link
          to="/crm/activities/new"
          className="px-4 py-2 bg-accent text-on-primary font-display tracking-wider"
        >
          NEW ACTIVITY
        </Link>
      </header>
      <select
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        className="bg-bg-2 border border-line px-3 py-2 font-sans w-48"
      >
        <option value="">All</option>
        <option value="open">Open</option>
        <option value="completed">Completed</option>
        <option value="cancelled">Cancelled</option>
      </select>
      {query.isLoading ? (
        <p className="font-sans text-ink-dim">Loading.</p>
      ) : (query.data?.length ?? 0) === 0 ? (
        <ListEmptyState
          entity="activity"
          explainer="Activities log calls, emails, and notes against a customer or opportunity."
          addLabel="Add activity"
          addTo="/crm/activities/new"
        />
      ) : (
        <table className="w-full border border-line">
          <thead className="bg-bg-2 text-left font-display tracking-wider text-sm">
            <tr>
              <th className="px-4 py-2">Kind</th>
              <th className="px-4 py-2">Subject</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Due</th>
            </tr>
          </thead>
          <tbody>
            {(query.data ?? []).map((a) => (
              <tr key={a.id} className="border-t border-line">
                <td className="px-4 py-2 font-sans">{a.kind}</td>
                <td className="px-4 py-2 font-sans">{a.subject}</td>
                <td className="px-4 py-2 font-sans">{a.status}</td>
                <td className="px-4 py-2 font-sans">{a.due_at ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
