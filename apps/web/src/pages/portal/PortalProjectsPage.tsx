// PortalProjectsPage. Standalone listing of the customer's projects.
//
// F-Wave9-PORTAL-NAV-01: now wrapped in PortalTopbar.

import { Button } from '@/components/ui/Button';
import { usePortalProjects } from '@/lib/hooks/useCrossCutting';
import { formatDateMedium } from '@/lib/dates';
import { StatusBadge } from './components/StatusBadge';
import { PortalTopbar } from './components/PortalTopbar';

interface PortalProjectRow {
  id: string;
  name: string;
  status: string;
  started_at: string | null;
  expected_completion_at: string | null;
}

export function PortalProjectsPage() {
  const query = usePortalProjects();
  const rows = (query.data ?? []) as PortalProjectRow[];

  return (
    <>
      <PortalTopbar />
      <main className="min-h-screen bg-bg px-6 py-10">
        <h1 className="mx-auto mb-6 max-w-5xl font-display text-3xl tracking-wide text-ink">
          PROJECTS
        </h1>
        <div className="mx-auto max-w-5xl">
          {query.isLoading ? (
            <p className="text-sm text-ink-dim">Loading projects.</p>
          ) : query.isError ? (
            <div className="flex items-center justify-between border border-line bg-bg-2 px-4 py-3">
              <p className="text-sm text-accent">
                Could not load your projects. Try again.
              </p>
              <Button
                onClick={() => query.refetch()}
                variant="secondary"
                className="px-3 py-1 text-sm"
              >
                Retry
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <p className="border border-dashed border-line px-4 py-6 text-center text-sm text-ink-dim">
              No projects yet. Active jobs will appear here once they kick off.
            </p>
          ) : (
            <table className="w-full border border-line text-sm">
              <thead>
                <tr className="bg-bg-2 text-left text-ink-dim">
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Started</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Est. completion</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="border-t border-line">
                    <td className="px-3 py-2 text-ink">{p.name}</td>
                    <td className="px-3 py-2 text-ink-dim">
                      {formatDateMedium(p.started_at)}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="px-3 py-2 text-ink-dim">
                      {formatDateMedium(p.expected_completion_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </>
  );
}
