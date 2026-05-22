import { Link } from 'react-router-dom';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { useExpensesList } from '@/lib/hooks/useExpenses';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';

export function ExpensesListPage() {
  const { data, isLoading } = useExpensesList();
  const caps = useVioCapabilities();
  return (
    <section className="px-8 py-12 max-w-6xl mx-auto flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-display tracking-wide text-ink">EXPENSES</h1>
        {caps.can('expenses.expense.create') ? (
          <Link to="/3pl-operations/expenses/new" className="px-4 py-2 bg-accent text-on-primary font-sans text-sm">New Expense</Link>
        ) : null}
      </header>
      {isLoading ? <p className="text-ink-dim">Loading.</p> : null}
      {!isLoading && (data ?? []).length === 0 ? (
        <ListEmptyState
          entity="expense"
          explainer="Expenses are operating costs outside of vendor bills."
          addLabel="Add expense"
          addTo="/3pl-operations/expenses/new"
          canAdd={caps.can('expenses.expense.create')}
        />
      ) : (
      <table className="w-full border border-line text-sm font-sans">
        <thead className="bg-bg-2 text-left text-ink-dim">
          <tr><th className="px-4 py-2">#</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Date</th><th className="px-4 py-2">Total</th></tr>
        </thead>
        <tbody>
          {(data ?? []).map((e) => (
            <tr key={e.id} className="border-t border-line">
              <td className="px-4 py-2"><Link to={`/3pl-operations/expenses/${e.id}`} className="text-ink underline">{e.expense_number ?? e.id.slice(0, 8)}</Link></td>
              <td className="px-4 py-2"><span className="inline-block px-2 py-0.5 border border-line text-xs font-mono uppercase text-ink-dim">{e.status}</span></td>
              <td className="px-4 py-2 text-ink-dim">{e.expense_date}</td>
              <td className="px-4 py-2 text-ink-dim">{String(e.total_cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      )}
    </section>
  );
}
