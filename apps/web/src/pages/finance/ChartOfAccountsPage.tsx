import { useChartOfAccounts } from '@/lib/hooks/useChartOfAccounts';

/**
 * ChartOfAccountsPage. Lists the seeded 13 default rows plus any custom
 * accounts. Write mutations ship in a Wave 3 polish pass.
 */
export function ChartOfAccountsPage() {
  const { data, isLoading, error } = useChartOfAccounts();

  return (
    <section className="px-8 py-8 flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-display tracking-wide text-ink">
          CHART OF ACCOUNTS
        </h1>
      </header>

      {isLoading ? (
        <p className="text-ink-dim">Loading accounts.</p>
      ) : error ? (
        <p className="text-accent">Failed to load accounts.</p>
      ) : (
        <table className="w-full text-sm font-sans border-collapse">
          <thead>
            <tr className="text-left text-ink-dim border-b border-line">
              <th className="py-2">Code</th>
              <th className="py-2">Name</th>
              <th className="py-2">Type</th>
              <th className="py-2">Active</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((a) => (
              <tr key={a.id} className="border-b border-line">
                <td className="py-2 font-mono">{a.code}</td>
                <td className="py-2">{a.name}</td>
                <td className="py-2 uppercase text-ink-dim">{a.account_type}</td>
                <td className="py-2 text-ink-dim">{a.is_active ? 'yes' : 'no'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
