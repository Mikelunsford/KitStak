import { useQuery } from '@tanstack/react-query';

import { exchangeRatesKeys } from '@/lib/queryKeys/exchangeRates';
import { listExchangeRates } from '@/lib/services/exchangeRatesService';

export function ExchangeRatesPage() {
  const { data, isLoading } = useQuery({
    queryKey: exchangeRatesKeys.list(),
    queryFn: () => listExchangeRates(),
  });
  return (
    <section className="px-8 py-12 max-w-4xl mx-auto flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">EXCHANGE RATES</h1>
      {isLoading && <p className="text-ink-dim">Loading.</p>}
      {data && (
        <table className="w-full border border-line">
          <thead className="bg-bg-2 text-left text-sm font-display tracking-wider text-ink">
            <tr>
              <th className="px-4 py-2">Base</th>
              <th className="px-4 py-2">Quote</th>
              <th className="px-4 py-2">Rate (1e-9)</th>
              <th className="px-4 py-2">Effective</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.id} className="border-t border-line">
                <td className="px-4 py-2 font-mono text-sm">{r.base_currency_code}</td>
                <td className="px-4 py-2 font-mono text-sm">{r.quote_currency_code}</td>
                <td className="px-4 py-2 font-mono text-sm">{String(r.rate_e9)}</td>
                <td className="px-4 py-2 font-mono text-sm">{r.effective_date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
