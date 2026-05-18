import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { opportunitiesKeys } from '@/lib/queryKeys/opportunities';
import {
  getOpportunity,
  transitionOpportunityStage,
} from '@/lib/services/opportunitiesService';
import {
  canCrmTransition,
  opportunityStageMachine,
  type OpportunityStageState,
} from '@/lib/workflow/crm';

export function OpportunityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: id ? opportunitiesKeys.detail(id) : ['crm', 'opportunities', 'detail', 'noop'],
    queryFn: () => getOpportunity(id as string),
    enabled: Boolean(id),
    staleTime: 30_000,
  });

  const mutation = useMutation({
    mutationFn: (stage: OpportunityStageState) =>
      transitionOpportunityStage(id as string, { stage }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: opportunitiesKeys.all });
    },
  });

  if (query.isLoading) {
    return <p className="px-8 py-10 font-sans text-ink-dim">Loading.</p>;
  }
  if (!query.data) {
    return <p className="px-8 py-10 font-sans text-accent">Opportunity not found.</p>;
  }
  const o = query.data;
  const allowed = opportunityStageMachine.states.filter((s) =>
    canCrmTransition(opportunityStageMachine, o.stage, s),
  );
  return (
    <section className="px-8 py-10 max-w-3xl mx-auto flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">
        {o.display_name.toUpperCase()}
      </h1>
      <dl className="grid grid-cols-2 gap-4 font-sans text-sm">
        <dt className="text-ink-dim">Stage</dt>
        <dd>{o.stage}</dd>
        <dt className="text-ink-dim">Customer id</dt>
        <dd className="font-mono text-xs">{o.customer_id}</dd>
        <dt className="text-ink-dim">Amount (cents)</dt>
        <dd className="font-mono">{o.amount_cents}</dd>
        <dt className="text-ink-dim">Currency</dt>
        <dd>{o.currency_code ?? ''}</dd>
        <dt className="text-ink-dim">Probability (pct)</dt>
        <dd>{o.probability_pct}</dd>
        <dt className="text-ink-dim">Expected close</dt>
        <dd>{o.expected_close_date ?? ''}</dd>
      </dl>
      <div className="flex flex-col gap-2">
        <h2 className="font-display tracking-wider text-sm text-ink-dim">
          ADVANCE STAGE
        </h2>
        <div className="flex flex-wrap gap-2">
          {allowed.length === 0 ? (
            <p className="text-ink-dim text-sm font-sans">No transitions available.</p>
          ) : (
            allowed.map((s) => (
              <button
                key={s}
                onClick={() => mutation.mutate(s)}
                disabled={mutation.isPending}
                className="px-3 py-1 bg-bg-2 border border-line text-sm font-display tracking-wider disabled:opacity-50"
              >
                {s.toUpperCase().replace('_', ' ')}
              </button>
            ))
          )}
        </div>
      </div>

      <section className="mt-6">
        <h2 className="text-2xl font-display tracking-wide text-ink mb-3">HISTORY</h2>
        <AuditTimeline entityType="opportunity" entityId={id ?? null} />
      </section>
    </section>
  );
}
