import { useTaxesList } from '@/lib/hooks/useTaxes';

export function TaxesPage() {
  const { data, isLoading, error } = useTaxesList();
  return (
    <section className="px-8 py-12 max-w-4xl mx-auto flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">TAXES</h1>
      {isLoading && <p className="text-ink-dim">Loading.</p>}
      {error && <p className="text-accent">Failed to load taxes.</p>}
      {data && (
        <table className="w-full border border-line">
          <thead className="bg-bg-2 text-left text-sm font-display tracking-wider text-ink">
            <tr>
              <th className="px-4 py-2">Code</th>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Rate</th>
              <th className="px-4 py-2">Default</th>
            </tr>
          </thead>
          <tbody>
            {data.map((tax) => (
              <tr key={tax.id} className="border-t border-line">
                <td className="px-4 py-2 font-mono text-sm">{tax.code}</td>
                <td className="px-4 py-2">{tax.name}</td>
                <td className="px-4 py-2 font-mono text-sm">
                  {(tax.rate_bps / 100).toFixed(2)}%
                </td>
                <td className="px-4 py-2">{tax.default_for_org ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
