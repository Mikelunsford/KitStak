import { Link } from 'react-router-dom';

import { useChartOfAccounts } from '@/lib/hooks/useChartOfAccounts';

/**
 * ChartOfAccountsPage. Lists the seeded default accounts plus any custom
 * accounts for the org, sorted by code. Provides a Create button wired to
 * /finance/coa/new and per-row edit links wired to /finance/coa/:id/edit.
 */
export function ChartOfAccountsPage() {
  const { data, isLoading, error } = useChartOfAccounts();

  return (
    <section className="px-8 py-8 flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-display tracking-wide text-ink">
          CHART OF ACCOUNTS
        </h1>
        <Link
          to="/finance/coa/new"
          className="px-4 py-2 bg-accent text-on-primary font-sans text-sm"
        >
          New account
        </Link>
      </header>

      {isLoading ? (
        <p className="text-ink-dim font-sans">Loading accounts.</p>
      ) : error ? (
        <p className="text-accent font-sans">Failed to load accounts.</p>
      ) : (
        <table className="w-full text-sm font-sans border-collapse">
          <thead>
            <tr className="text-left text-ink-dim border-b border-line">
              <th className="py-2 pr-4">Code</th>
              <th className="py-2 pr-4">Name</th>
              <th className="py-2 pr-4">Type</th>
              <th className="py-2 pr-4">Active</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((a) => (
              <tr key={a.id} className="border-b border-line">
                <td className="py-2 pr-4 font-mono">{a.code}</td>
                <td className="py-2 pr-4">{a.name}</td>
                <td className="py-2 pr-4 uppercase text-ink-dim">{a.account_type}</td>
                <td className="py-2 pr-4 text-ink-dim">{a.is_active ? 'yes' : 'no'}</td>
                <td className="py-2 text-right">
                  <Link
                    to={`/finance/coa/${a.id}/edit`}
                    className="text-ink-dim hover:text-accent text-xs"
                  >
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
            {(data ?? []).length === 0 ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-ink-dim">
                  No accounts found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      )}
    </section>
  );
}
