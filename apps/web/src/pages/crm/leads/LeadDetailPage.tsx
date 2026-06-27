import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import { StateStepper } from '@/components/shell/StateStepper';
import { EntityLabel } from '@/components/data/EntityLabel';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { auditLogKeys } from '@/lib/queryKeys/auditLog';
import { leadsKeys } from '@/lib/queryKeys/leads';
import { getLead, updateLead } from '@/lib/services/leadsService';
import { canCrmTransition, leadStateMachine } from '@/lib/workflow/crm';
import {
  STATE_STEPPER_PATHS,
  isOffPath,
  nextStepperState,
} from '@/lib/workflow/stateStepperPaths';

// The lead statuses reachable through PATCH /crm-api/leads/:id. Mirrors the
// LeadPatchSchema status enum (apps/web/src/lib/types/crm.ts): 'converted' is
// excluded because the server refuses it on patch and routes conversion
// through the dedicated CONVERT button + POST /:id/convert endpoint.
const PATCHABLE_STATUSES = ['new', 'working', 'qualified', 'disqualified'] as const;
type PatchableLeadStatus = (typeof PATCHABLE_STATUSES)[number];

export function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const caps = useCapabilities();
  const query = useQuery({
    queryKey: id ? leadsKeys.detail(id) : ['crm', 'leads', 'detail', 'noop'],
    queryFn: () => getLead(id as string),
    enabled: Boolean(id),
    staleTime: 30_000,
  });

  const mutation = useMutation({
    mutationFn: (status: PatchableLeadStatus) =>
      updateLead(id as string, { status }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: leadsKeys.all });
      if (id) {
        void qc.invalidateQueries({ queryKey: leadsKeys.detail(id) });
        // The status PATCH writes an audit_log row via the lead state trigger;
        // invalidate the timeline so the new entry shows on this page.
        void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('lead', id) });
      }
    },
  });

  if (query.isLoading) {
    return <p className="px-8 py-10 font-sans text-ink-dim">Loading.</p>;
  }
  if (!query.data) {
    return <p className="px-8 py-10 font-sans text-accent">Lead not found.</p>;
  }
  const l = query.data;

  // R-W15-CRM-01: the SPA had no surface to advance a lead's status, so a lead
  // could never reach `qualified` and the CONVERT button (and convert_lead RPC)
  // were dead in practice. These controls mirror OpportunityDetailPage's stage
  // advance: the server (crm-api patchLead, crm.leads.write) is authority and
  // validates the same leadStateMachine; the SPA hides invalid moves only.
  const canAdvance = caps.can('crm.leads.write');
  const allowed = PATCHABLE_STATUSES.filter((s) =>
    canCrmTransition(leadStateMachine, l.status, s),
  );
  const railNext = nextStepperState(STATE_STEPPER_PATHS.lead.path, l.status);
  const canAdvanceRail =
    railNext !== null &&
    canAdvance &&
    (allowed as readonly string[]).includes(railNext);
  const advanceRail = (toState: string) =>
    mutation.mutate(toState as PatchableLeadStatus);
  return (
    <section className="px-8 py-10 max-w-3xl mx-auto flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: 'Leads', to: '/crm/leads' },
          { label: l.display_name },
        ]}
      />
      {/* UX-Q7: display-only horizontal progress stepper. Replaces the
          Status row in the dl below; the stepper visualizes lead progress
          from new -> working -> qualified -> converted. disqualified is
          the off-path sink. */}
      <StateStepper
        steps={[...STATE_STEPPER_PATHS.lead.path]}
        current={l.status}
        offPath={
          isOffPath('lead', l.status)
            ? {
                state: l.status,
                label: STATE_STEPPER_PATHS.lead.resolveLabel(l.status),
              }
            : undefined
        }
        onAdvance={canAdvanceRail ? advanceRail : undefined}
        advancePending={mutation.isPending}
      />
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-4xl font-display tracking-wide text-ink">
          {l.display_name.toUpperCase()}
        </h1>
        <div className="flex items-center gap-2">
          <Link
            to={`/crm/leads/${l.id}/edit`}
            className="px-4 py-2 bg-bg-2 border border-line font-display tracking-wider"
          >
            EDIT
          </Link>
          {l.status === 'qualified' ? (
            <Link
              to={`/crm/leads/${l.id}/convert`}
              className="px-4 py-2 bg-accent text-on-primary font-display tracking-wider"
            >
              CONVERT
            </Link>
          ) : null}
        </div>
      </header>
      <dl className="grid grid-cols-2 gap-4 font-sans text-sm">
        <dt className="text-ink-dim">Company</dt>
        <dd>{l.company_name ?? ''}</dd>
        <dt className="text-ink-dim">Source</dt>
        <dd>{l.source ?? ''}</dd>
        <dt className="text-ink-dim">Email</dt>
        <dd>{l.primary_email ?? ''}</dd>
        <dt className="text-ink-dim">Estimated value (cents)</dt>
        <dd>{l.estimated_value_cents}</dd>
        <dt className="text-ink-dim">Currency</dt>
        <dd>{l.currency_code ?? ''}</dd>
        <dt className="text-ink-dim">Converted customer</dt>
        <dd>{l.converted_customer_id ? <EntityLabel kind="customer" id={l.converted_customer_id} /> : ''}</dd>
        <dt className="text-ink-dim">Converted opportunity</dt>
        <dd>{l.converted_opportunity_id ? <EntityLabel kind="opportunity" id={l.converted_opportunity_id} /> : ''}</dd>
      </dl>

      {/* R-W15-CRM-01: status-advance cluster, gated on crm.leads.write (hidden
          for roles without it, mirroring OpportunityDetailPage). Convert is not
          offered here; it stays on the dedicated CONVERT button once qualified. */}
      {canAdvance && (
        <div className="flex flex-col gap-2">
          <h2 className="font-display tracking-wider text-sm text-ink-dim">
            ADVANCE STATUS
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
                  {s.toUpperCase()}
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
      )}

      <section className="mt-6">
        <h2 className="text-2xl font-display tracking-wide text-ink mb-3">HISTORY</h2>
        <AuditTimeline entityType="lead" entityId={id ?? null} />
      </section>
    </section>
  );
}
