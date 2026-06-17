// ExpenseDetailPage. Migration to the shared UI kit (F-Wave10-UI-KIT-01, 3PL
// CRUD tail): PageHeader + DetailLayout (HISTORY in the rail) replace the
// hand-rolled header and bottom-of-page history section; FSM transition
// buttons move to the kit Button and humanise their target-state labels
// (was a raw-enum leak). Money fix: amount / tax / total now render through
// formatCents instead of raw String(*_cents) (constitution: never raw cents).
// FSM transitions, the capability gates, and the StateStepper are preserved.

import { Link, useParams } from 'react-router-dom';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import { StateStepper } from '@/components/shell/StateStepper';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { DetailLayout } from '@/components/ui/DetailLayout';
import { humaniseStatus } from '@/components/ui/StatusBadge';
import { useExpense, useTransitionExpense } from '@/lib/hooks/useExpenses';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { EXPENSE_FSM } from '@/lib/workflow/vendors_inventory_ops';
import type { ExpenseStatus } from '@/lib/types/vendors_inventory_ops';
import { formatCents } from '@/lib/money';
import {
  STATE_STEPPER_PATHS,
  isOffPath,
  nextStepperState,
} from '@/lib/workflow/stateStepperPaths';

export function ExpenseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const exp = useExpense(id);
  const transition = useTransitionExpense(id ?? '');
  const caps = useVioCapabilities();
  if (exp.isLoading) return <p className="px-8 py-12 text-ink-dim">Loading.</p>;
  if (exp.error || !exp.data)
    return <p className="px-8 py-12 text-accent">Expense not found.</p>;
  const d = exp.data;
  const next = EXPENSE_FSM.transitions
    .filter((t) => t.from === d.status)
    .map((t) => t.to);

  // Map a transition target to the capability that authorizes it (button
  // hiding only; the server is authority). Preserved verbatim from the
  // pre-kit page; reimbursed shares the pay cap, draft (revise) shares submit.
  const capByTarget: Record<
    string,
    | 'expenses.expense.submit'
    | 'expenses.expense.approve'
    | 'expenses.expense.pay'
    | 'expenses.expense.reject'
  > = {
    submitted: 'expenses.expense.submit',
    approved: 'expenses.expense.approve',
    paid: 'expenses.expense.pay',
    reimbursed: 'expenses.expense.pay',
    rejected: 'expenses.expense.reject',
    draft: 'expenses.expense.submit',
  };

  // UX-Q7 reopened (Pattern D): the rail's immediate next happy-path status is
  // interactive only when it is a transition this page already exposes (it is in
  // `next`) and the operator holds the capability that authorizes it. Every
  // expense forward edge (draft -> submitted -> approved -> paid -> reimbursed)
  // is a manual transition driven by the same buttons below, so the gate maps
  // cleanly; advance reuses the same mutation and the server enforces the cap.
  const railNext = nextStepperState(STATE_STEPPER_PATHS.expense.path, d.status);
  const canAdvanceRail =
    railNext !== null &&
    (next as readonly string[]).includes(railNext) &&
    (capByTarget[railNext] === undefined || caps.can(capByTarget[railNext]));
  const advance = (toState: string) =>
    transition.mutate(toState as ExpenseStatus);

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-6 px-8 py-12">
      <Breadcrumbs
        items={[
          { label: 'Expenses', to: '/purchasing/expenses' },
          { label: d.expense_number ?? d.id.slice(0, 8) },
        ]}
      />
      {/* UX-Q7 reopened (Pattern D): the rail's immediate next step is an
          interactive control that advances the expense (advance maps it to the
          same transition mutation as the action buttons below). It is only
          interactive when that next status is a transition this page exposes and
          the operator holds the authorizing capability. Past, current, and
          further-future steps stay display-only. */}
      <StateStepper
        steps={[...STATE_STEPPER_PATHS.expense.path]}
        current={d.status}
        offPath={
          isOffPath('expense', d.status)
            ? {
                state: d.status,
                label: STATE_STEPPER_PATHS.expense.resolveLabel(d.status),
              }
            : undefined
        }
        onAdvance={canAdvanceRail ? advance : undefined}
        advancePending={transition.isPending}
      />
      <PageHeader
        title={`Expense ${d.expense_number ?? d.id.slice(0, 8)}`}
        actions={
          <Link to={`/purchasing/expenses/${d.id}/edit`}>
            <Button variant="secondary">Edit</Button>
          </Link>
        }
      />

      <DetailLayout
        rail={
          <section>
            <h2 className="mb-3 text-2xl font-display tracking-wide text-ink">
              HISTORY
            </h2>
            <AuditTimeline entityType="expense" entityId={id ?? null} />
          </section>
        }
      >
        {transition.error && (
          <p className="font-sans text-sm text-accent">
            {transition.error instanceof Error
              ? transition.error.message
              : 'Transition failed.'}
          </p>
        )}
        {next.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {next.map((to) => {
              const needed = capByTarget[to];
              if (needed && !caps.can(needed)) return null;
              return (
                <Button
                  key={to}
                  variant="secondary"
                  disabled={transition.isPending}
                  onClick={() => transition.mutate(to as ExpenseStatus)}
                >
                  {humaniseStatus(to)}
                </Button>
              );
            })}
          </div>
        ) : null}
        <dl className="grid grid-cols-2 gap-4 font-sans text-sm">
          <dt className="text-ink-dim">Date</dt>
          <dd className="text-ink">{d.expense_date}</dd>
          <dt className="text-ink-dim">Amount</dt>
          <dd className="font-mono text-ink">
            {formatCents(d.amount_cents as number | string, d.currency_code)}
          </dd>
          <dt className="text-ink-dim">Tax</dt>
          <dd className="font-mono text-ink">
            {formatCents(d.tax_cents as number | string, d.currency_code)}
          </dd>
          <dt className="text-ink-dim">Total</dt>
          <dd className="font-mono text-ink">
            {formatCents(d.total_cents as number | string, d.currency_code)}
          </dd>
          <dt className="text-ink-dim">Reimbursable</dt>
          <dd className="text-ink">{d.reimbursable ? 'Yes' : 'No'}</dd>
          <dt className="text-ink-dim">Description</dt>
          <dd className="text-ink">{d.description ?? ''}</dd>
        </dl>
      </DetailLayout>
    </section>
  );
}
