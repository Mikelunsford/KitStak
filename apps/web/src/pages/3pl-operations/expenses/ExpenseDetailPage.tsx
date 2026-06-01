import { Link, useParams } from 'react-router-dom';
import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import { StateStepper } from '@/components/shell/StateStepper';
import { useExpense, useTransitionExpense } from '@/lib/hooks/useExpenses';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { EXPENSE_FSM } from '@/lib/workflow/vendors_inventory_ops';
import type { ExpenseStatus } from '@/lib/types/vendors_inventory_ops';
import {
  STATE_STEPPER_PATHS,
  isOffPath,
} from '@/lib/workflow/stateStepperPaths';

export function ExpenseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const exp = useExpense(id);
  const transition = useTransitionExpense(id ?? '');
  const caps = useVioCapabilities();
  if (exp.isLoading) return <p className="px-8 py-12 text-ink-dim">Loading.</p>;
  if (exp.error || !exp.data) return <p className="px-8 py-12 text-accent">Expense not found.</p>;
  const d = exp.data;
  const next = EXPENSE_FSM.transitions.filter((t) => t.from === d.status).map((t) => t.to);
  return (
    <section className="px-8 py-12 max-w-4xl mx-auto flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: 'Expenses', to: '/3pl-operations/expenses' },
          { label: d.expense_number ?? d.id.slice(0, 8) },
        ]}
      />
      {/* UX-Q7: display-only horizontal progress stepper. */}
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
      />
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-4xl font-display tracking-wide text-ink">EXPENSE {d.expense_number ?? d.id.slice(0, 8)}</h1>
        <Link
          to={`/3pl-operations/expenses/${d.id}/edit`}
          className="px-4 py-2 bg-bg-2 border border-line font-display tracking-wider"
        >
          EDIT
        </Link>
      </header>
      {transition.error && (
        <p className="font-sans text-sm text-accent">
          {transition.error instanceof Error
            ? transition.error.message
            : 'Transition failed.'}
        </p>
      )}
      {next.length > 0 ? (
        <div className="flex gap-2">
          {next.map((to) => {
            // Map transition to capability for button hiding
            const capByTarget: Record<string, 'expenses.expense.submit' | 'expenses.expense.approve' | 'expenses.expense.pay' | 'expenses.expense.reject'> = {
              submitted: 'expenses.expense.submit', approved: 'expenses.expense.approve',
              paid: 'expenses.expense.pay', reimbursed: 'expenses.expense.pay',
              rejected: 'expenses.expense.reject', draft: 'expenses.expense.submit',
            };
            const needed = capByTarget[to];
            if (needed && !caps.can(needed)) return null;
            return (
              <button key={to} disabled={transition.isPending}
                onClick={() => transition.mutate(to as ExpenseStatus)}
                className="px-3 py-1 border border-line font-sans text-xs uppercase text-ink hover:bg-bg-2">
                {to}
              </button>
            );
          })}
        </div>
      ) : null}
      <dl className="grid grid-cols-2 gap-4 font-sans text-sm">
        <dt className="text-ink-dim">Date</dt><dd className="text-ink">{d.expense_date}</dd>
        <dt className="text-ink-dim">Amount</dt><dd className="text-ink">{String(d.amount_cents)}</dd>
        <dt className="text-ink-dim">Tax</dt><dd className="text-ink">{String(d.tax_cents)}</dd>
        <dt className="text-ink-dim">Total</dt><dd className="text-ink">{String(d.total_cents)}</dd>
        <dt className="text-ink-dim">Reimbursable</dt><dd className="text-ink">{d.reimbursable ? 'Yes' : 'No'}</dd>
        <dt className="text-ink-dim">Description</dt><dd className="text-ink">{d.description ?? ''}</dd>
      </dl>

      <section className="mt-6">
        <h2 className="text-2xl font-display tracking-wide text-ink mb-3">HISTORY</h2>
        <AuditTimeline entityType="expense" entityId={id ?? null} />
      </section>
    </section>
  );
}
