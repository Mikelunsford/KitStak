// OpportunitiesPipelinePage. CRM Sell surface. Migration to the shared UI kit
// (F-Wave10-UI-KIT-01): PageHeader + kit Button replace the hand-rolled header
// and the link-as-button CTA. The six-column pipeline (aligned with the
// opportunity stage machine) stays bespoke.
//
// Money fix (bug-fix rider): the per-card amount and the per-column total
// rendered raw cents (`{o.amount_cents}` and `total cents: {total}`). Both now
// render through formatCents. The per-card amount uses its own currency_code;
// the column total uses USD (the column sums cents across opportunities that may
// carry mixed currencies, which is a pre-existing limitation tracked separately
// from this presentation migration).

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { opportunitiesKeys } from '@/lib/queryKeys/opportunities';
import { listOpportunities } from '@/lib/services/opportunitiesService';
import { formatCents } from '@/lib/money';
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
    <section className="mx-auto flex max-w-7xl flex-col gap-6 px-8 py-10">
      <PageHeader
        eyebrow="CRM / Opportunities"
        title="Pipeline"
        actions={
          <Link to="/crm/opportunities/new">
            <Button variant="primary">New opportunity</Button>
          </Link>
        }
      />
      {query.isLoading ? (
        <p className="font-sans text-ink-dim">Loading.</p>
      ) : (
        <div role="region" aria-label="Opportunities pipeline" className="grid grid-cols-6 gap-3">
          {columns.map((col) => {
            const inCol = (query.data ?? []).filter((o) => o.stage === col);
            const total = inCol.reduce((sum, o) => sum + o.amount_cents, 0);
            return (
              <div key={col} className="bg-bg-2 border border-line">
                <h2 className="px-3 py-2 font-display tracking-wider text-sm border-b border-line">
                  {col.toUpperCase().replace('_', ' ')} ({inCol.length})
                </h2>
                <div className="px-3 py-1 text-xs font-mono text-ink-dim border-b border-line">
                  Total {formatCents(total, 'USD')}
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
                        {formatCents(o.amount_cents, o.currency_code ?? 'USD')}
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
