import { Link } from 'react-router-dom';

import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { Button } from '@/components/ui/Button';
import { useProjectsList } from '@/lib/hooks/useProjects';

export function ProjectsListPage() {
  const { data, isLoading, error } = useProjectsList();
  return (
    <section className="px-8 py-12 max-w-6xl mx-auto flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-display tracking-wide text-ink">PROJECTS</h1>
        <Link to="/3pl-operations/projects/new">
          <Button variant="primary">New Project</Button>
        </Link>
      </header>
      {isLoading && <p className="text-ink-dim">Loading.</p>}
      {error && <p className="text-accent">Failed to load projects.</p>}
      {data && data.length === 0 ? (
        <ListEmptyState
          entity="project"
          explainer="Projects are accepted quotes you are delivering."
          addLabel="Add project"
          addTo="/3pl-operations/projects/new"
        />
      ) : null}
      {data && data.length > 0 && (
        <table className="w-full border border-line">
          <thead className="bg-bg-2 text-left text-sm font-display tracking-wider text-ink">
            <tr>
              <th className="px-4 py-2">Number</th>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">State</th>
              <th className="px-4 py-2">Due</th>
            </tr>
          </thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.id} className="border-t border-line">
                <td className="px-4 py-2 font-mono text-sm">
                  <Link to={`/3pl-operations/projects/${p.id}`} className="text-ink hover:text-accent">
                    {p.number}
                  </Link>
                </td>
                <td className="px-4 py-2">{p.name}</td>
                <td className="px-4 py-2">{p.state}</td>
                <td className="px-4 py-2 font-mono text-sm">{p.due_date ?? '.'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
