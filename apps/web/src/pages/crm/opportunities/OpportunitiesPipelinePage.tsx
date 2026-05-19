import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { opportunitiesKeys } from '@/lib/queryKeys/opportunities';
import { listOpportunities } from '@/lib/services/opportunitiesService';
import {
  opportunityStageMachine,
  type OpportunityStageState,
} from '@/lib/workflow/crm';

export function OpportunitiesPipelinePage() {
  const query = useQuery({
    queryKey: opportunitiesKeys.list({}),
    queryFn: () => listOpportunities({}),
    staleTime: 30_000,
  });
  const columns: OpportunityStageState[] = [...opportunityStageMachine.states];

  return (
    <section className="px-8 py-10 max-w-7xl mx-auto flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-display tracking-wide text-ink">PIPELINE</h1>
        <Link to="/crm/opportunities/new" className="px-4 py-2 bg-accent text-on-primary font-sans text-sm">New opportunity</Link>
      </header>
      {query.isLoading ? (
        <p className="font-sans text-ink-dim">Loading.</p>
      ) : (
        <div className="grid grid-cols-6 gap-3">
          {columns.map((col) => {
            const inCol = (query.data ?? []).filter((o) => o.stage === col);
            const total = inCol.reduce((sum, o) => sum + o.amount_cents, 0);
            return (
              <div key={col} className="bg-bg-2 border border-line">
                <h2 className="px-3 py-2 font-display tracking-wider text-sm border-b border-line">
                  {col.toUpperCase().replace('_', ' ')} ({inCol.length})
                </h2>
                <div className="px-3 py-1 text-xs font-mono text-ink-dim border-b border-line">
                  total cents: {total}
                </div>
                <ul className="flex flex-col gap-2 p-2 min-h-32">
                  {inCol.map((o) => (
                    <li
                      key={o.id}
                      className="border border-line bg-bg-1 p-2 text-sm font-sans"
                    >
                      <Link to={`/crm/opportunities/${o.id}`} className="underline">
                        {o.display_name}
                      </Link>
                      <div className="text-ink-dim text-xs font-mono">
                        {o.amount_cents} {o.currency_code ?? ''}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
