import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { vasKeys } from '@/lib/queryKeys/vas';
import { listValueAddedServices } from '@/lib/services/vasService';
import { formatCents } from '@/lib/money';

export function ValueAddedServicesPage() {
  const { data, isLoading } = useQuery({
    queryKey: vasKeys.list(),
    queryFn: () => listValueAddedServices(),
  });
  return (
    <section className="px-8 py-12 max-w-4xl mx-auto flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-4xl font-display tracking-wide text-ink">VALUE ADDED SERVICES</h1>
        <Link
          to="/3pl-operations/vas/new"
          className="px-4 py-2 bg-accent text-on-primary font-display tracking-wider text-sm"
        >
          ADD SERVICE
        </Link>
      </div>
      {isLoading && <p className="text-ink-dim">Loading.</p>}
      {data && (
        <table className="w-full border border-line">
          <thead className="bg-bg-2 text-left text-sm font-display tracking-wider text-ink">
            <tr>
              <th className="px-4 py-2">Code</th>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Kind</th>
              <th className="px-4 py-2">Base price</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {data.map((v) => (
              <tr key={v.id} className="border-t border-line">
                <td className="px-4 py-2 font-mono text-sm">{v.code}</td>
                <td className="px-4 py-2">{v.name}</td>
                <td className="px-4 py-2">{v.kind}</td>
                <td className="px-4 py-2 font-mono text-sm">
                  {formatCents(v.base_price_cents, v.currency_code)}
                </td>
                <td className="px-4 py-2 text-right">
                  <Link
                    to={`/3pl-operations/vas/${v.id}/edit`}
                    className="text-sm text-accent font-display tracking-wider"
                  >
                    EDIT
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
