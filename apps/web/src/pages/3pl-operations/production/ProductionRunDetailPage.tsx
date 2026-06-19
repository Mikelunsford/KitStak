// ProductionRunDetailPage. 3PL production. Migration to the shared UI kit
// (F-Wave10-UI-KIT-01): PageHeader + DetailLayout (HISTORY in the rail) replace
// the hand-rolled header and bottom history section. production_run IS
// registered in STATE_STEPPER_PATHS, so the StateStepper is kept (it sits above
// the PageHeader and shows the status, so no separate StatusBadge and no
// eyebrow). The Start / Complete transitions move to the kit Button; Complete
// keeps its destructiveConfirm (it writes production_consumed / produced stock
// movements and cannot be undone). The cap gates and the facts <dl> are
// preserved verbatim.

import { useParams } from 'react-router-dom';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import { StateStepper } from '@/components/shell/StateStepper';
import { EntityLabel } from '@/components/data/EntityLabel';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { DetailLayout } from '@/components/ui/DetailLayout';
import {
  useProductionRun,
  useStartProductionRun,
  useCompleteProductionRun,
} from '@/lib/hooks/useOps';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { destructiveConfirm } from '@/lib/destructiveConfirm';
import {
  STATE_STEPPER_PATHS,
  isOffPath,
  nextStepperState,
} from '@/lib/workflow/stateStepperPaths';

export function ProductionRunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const run = useProductionRun(id);
  const start = useStartProductionRun(id ?? '');
  const complete = useCompleteProductionRun(id ?? '');
  const caps = useVioCapabilities();

  if (run.isLoading) return <p className="px-8 py-12 text-ink-dim">Loading.</p>;
  if (run.error || !run.data)
    return <p className="px-8 py-12 text-accent">Production run not found.</p>;
  const d = run.data;

  // F-UIUX-RAIL-FIRST-EDGE-01 (Pattern D, UX-Q7 reopened): the rail's immediate
  // next happy-path step is interactive only for the SAFE FIRST EDGE
  // planned -> in_progress, which reuses the existing Start mutation. The rail
  // never offers in_progress -> completed: that edge is destructive (it writes
  // production_consumed and production_produced stock movements) and stays
  // behind the Complete button's destructiveConfirm. Gate mirrors the Start
  // button: planned status, holds production.start, and the path's next step is
  // exactly `in_progress`. The server stays the authority.
  const railNext = nextStepperState(
    STATE_STEPPER_PATHS.production_run.path,
    d.status,
  );
  const canAdvanceRail =
    railNext === 'in_progress' &&
    d.status === 'planned' &&
    caps.can('production.start');
  const advance = () => start.mutate();

  async function onComplete() {
    // UX-Q8: Complete on a production run writes production_consumed and
    // production_produced stock movements; the transition cannot be undone.
    if (
      !(await destructiveConfirm({
        action: 'Complete this production run',
        consequence:
          'This writes production_consumed and production_produced stock movements.',
        irreversible: true,
      }))
    )
      return;
    complete.mutate({ quantity_produced: d.quantity_planned, consumed: [] });
  }

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6 px-8 py-12">
      {/* production_run is a legacy-only entity: every create path is retired
          (the /3pl-operations/production list+create routes are <Navigate>
          redirects to the manufacturing pillar, ops-api POST /production-runs
          has no caller). This detail page is reachable only by deep link and
          the stock-ledger source cell, so the leading crumbs are display-only.
          A `to: '/3pl-operations/production'` here redirected to
          /manufacturing/runs (a different table's list that never contains this
          run). See F-Wave9-LEGACY-PRODUCTION-ROUTE-RETIRE-01. */}
      <Breadcrumbs
        items={[
          { label: 'Production runs' },
          { label: d.run_number ?? d.id.slice(0, 8) },
        ]}
      />
      {/* UX-Q7 reopened (Pattern D): the rail's immediate next step is an
          interactive control ONLY for the safe first edge planned -> in_progress,
          which fires the same Start mutation as the button below. It is never
          interactive for in_progress -> completed (destructive). Past, current,
          and the terminal step stay display-only. */}
      <StateStepper
        steps={[...STATE_STEPPER_PATHS.production_run.path]}
        current={d.status}
        offPath={
          isOffPath('production_run', d.status)
            ? {
                state: d.status,
                label: STATE_STEPPER_PATHS.production_run.resolveLabel(d.status),
              }
            : undefined
        }
        onAdvance={canAdvanceRail ? advance : undefined}
        advancePending={start.isPending}
      />
      <PageHeader title={`Production run ${d.run_number ?? d.id.slice(0, 8)}`} />

      <DetailLayout
        rail={
          <section>
            <h2 className="mb-3 text-2xl font-display tracking-wide text-ink">
              HISTORY
            </h2>
            <AuditTimeline entityType="production_run" entityId={id ?? null} />
          </section>
        }
      >
        <div className="flex gap-2 flex-wrap">
          {d.status === 'planned' && caps.can('production.start') && (
            <Button
              variant="secondary"
              onClick={() => start.mutate()}
              disabled={start.isPending}
            >
              Start
            </Button>
          )}
          {d.status === 'in_progress' && caps.can('production.complete') && (
            <Button
              variant="secondary"
              onClick={onComplete}
              disabled={complete.isPending}
            >
              Complete
            </Button>
          )}
        </div>
        {(start.error || complete.error) && (
          <p className="font-sans text-sm text-accent">
            {(start.error instanceof Error && start.error.message) ||
              (complete.error instanceof Error && complete.error.message) ||
              'Action failed.'}
          </p>
        )}

        <dl className="grid grid-cols-2 gap-4 font-sans text-sm">
          <dt className="text-ink-dim">Warehouse</dt>
          <dd className="text-ink">
            <EntityLabel kind="warehouse" id={d.warehouse_id} />
          </dd>
          <dt className="text-ink-dim">Output item</dt>
          <dd className="text-ink">
            <EntityLabel kind="item" id={d.output_item_id} />
          </dd>
          <dt className="text-ink-dim">Planned</dt>
          <dd className="text-ink">{String(d.quantity_planned)}</dd>
          <dt className="text-ink-dim">Produced</dt>
          <dd className="text-ink">{String(d.quantity_produced)}</dd>
          <dt className="text-ink-dim">Scheduled</dt>
          <dd className="text-ink">{d.scheduled_for ?? ''}</dd>
        </dl>
      </DetailLayout>
    </section>
  );
}
