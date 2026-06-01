import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import { StateStepper } from '@/components/shell/StateStepper';
import { useCustomer } from '@/lib/hooks/useCustomer';
import {
  STATE_STEPPER_PATHS,
  isOffPath,
} from '@/lib/workflow/stateStepperPaths';
import { auditLogKeys } from '@/lib/queryKeys/auditLog';
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

  // G-OPP-DETAIL-01: resolve customer display_name once the opportunity loads
  // so the detail page surfaces a human-readable customer link instead of a
  // raw UUID. Falls back to the UUID if the lookup fails (deleted customer
  // edge case).
  const customerQuery = useCustomer(query.data?.customer_id);

  const mutation = useMutation({
    mutationFn: (stage: OpportunityStageState) =>
      transitionOpportunityStage(id as string, { stage }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: opportunitiesKeys.all });
      // F-Wave7-AUDIT-CACHE-SWEEP-01: stage transitions write an audit_log
      // row via trg_audit_opportunities_state; invalidate the timeline so
      // the operator returning to this page sees the new entry.
      if (id) {
        void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('opportunity', id) });
      }
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

  // G-OPP-FLOW-01: "Create quote from opportunity" carries the customer_id
  // through the query string to QuoteCreatePage, which reads it via
  // useSearchParams().get('customer_id') and pre-fills the customer picker.
  const createQuoteHref = `/3pl-operations/quotes/new?customer_id=${o.customer_id}`;

  return (
    <section className="px-8 py-10 max-w-3xl mx-auto flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: 'Opportunities', to: '/crm/opportunities' },
          { label: o.display_name },
        ]}
      />
      {/* UX-Q7: display-only horizontal progress stepper. Replaces the
          Stage row in the dl below; visualizes discovery -> evaluation
          -> proposal -> negotiation -> closed_won. closed_lost is the
          off-path sink. Existing stage-advance buttons below remain
          unchanged - they drive transitions; the stepper only visualizes. */}
      <StateStepper
        steps={[...STATE_STEPPER_PATHS.opportunity.path]}
        current={o.stage}
        offPath={
          isOffPath('opportunity', o.stage)
            ? {
                state: o.stage,
                label: STATE_STEPPER_PATHS.opportunity.resolveLabel(o.stage),
              }
            : undefined
        }
      />
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-4xl font-display tracking-wide text-ink">
          {o.display_name.toUpperCase()}
        </h1>
        <div className="flex items-center gap-2">
          <Link
            to={`/crm/opportunities/${o.id}/edit`}
            className="px-4 py-2 bg-bg-2 border border-line font-display tracking-wider"
          >
            EDIT
          </Link>
          <Link
            to={createQuoteHref}
            className="px-4 py-2 bg-accent text-on-primary font-display tracking-wider"
          >
            CREATE QUOTE FROM OPPORTUNITY
          </Link>
        </div>
      </header>
      <dl className="grid grid-cols-2 gap-4 font-sans text-sm">
        <dt className="text-ink-dim">Customer</dt>
        <dd>
          <Link
            to={`/crm/customers/${o.customer_id}`}
            className="underline"
          >
            {customerQuery.data?.display_name ?? o.customer_id}
          </Link>
        </dd>
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
        {mutation.error && (
          <p className="font-sans text-sm text-accent">
            {mutation.error instanceof Error
              ? mutation.error.message
              : 'Transition failed.'}
          </p>
        )}
      </div>

      <section className="mt-6">
        <h2 className="text-2xl font-display tracking-wide text-ink mb-3">HISTORY</h2>
        <AuditTimeline entityType="opportunity" entityId={id ?? null} />
      </section>
    </section>
  );
}
