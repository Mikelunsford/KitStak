import { useQuery } from '@tanstack/react-query';

import { pricingTiersKeys } from '@/lib/queryKeys/pricingTiers';
import { listPricingTiers } from '@/lib/services/pricingTiersService';

export function PricingTiersPage() {
  const { data, isLoading } = useQuery({
    queryKey: pricingTiersKeys.list(),
    queryFn: () => listPricingTiers(),
  });
  return (
    <section className="px-8 py-12 max-w-3xl mx-auto flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">PRICING TIERS</h1>
      {isLoading && <p className="text-ink-dim">Loading.</p>}
      {data && (
        <table className="w-full border border-line">
          <thead className="bg-bg-2 text-left text-sm font-display tracking-wider text-ink">
            <tr>
              <th className="px-4 py-2">Code</th>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Discount</th>
            </tr>
          </thead>
          <tbody>
            {data.map((t) => (
              <tr key={t.id} className="border-t border-line">
                <td className="px-4 py-2 font-mono text-sm">{t.code}</td>
                <td className="px-4 py-2">{t.name}</td>
                <td className="px-4 py-2 font-mono text-sm">
                  {(t.discount_bps / 100).toFixed(2)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
