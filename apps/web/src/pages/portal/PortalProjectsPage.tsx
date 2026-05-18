// PortalProjectsPage.

import { Link } from 'react-router-dom';
import { usePortalProjects } from '@/lib/hooks/useCrossCutting';

export function PortalProjectsPage() {
  const query = usePortalProjects();
  return (
    <main className="min-h-screen bg-bg px-6 py-10">
      <h1 className="mx-auto mb-6 max-w-5xl font-display text-3xl tracking-wide text-ink">
        PROJECTS
      </h1>
      <div className="mx-auto max-w-5xl">
        {query.isLoading ? (
          <p className="text-sm text-ink-dim">Loading.</p>
        ) : (query.data ?? []).length === 0 ? (
          <p className="text-sm text-ink-dim">No projects yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {(query.data ?? []).map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between border border-line px-3 py-2 text-sm"
              >
                <Link to={`/portal/projects/${p.id}`} className="text-ink hover:underline">
                  {p.name}
                </Link>
                <span className="text-ink-dim">{p.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
