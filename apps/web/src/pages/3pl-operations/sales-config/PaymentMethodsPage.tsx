import { useQuery } from '@tanstack/react-query';

import { paymentMethodsKeys } from '@/lib/queryKeys/paymentMethods';
import { listPaymentMethods } from '@/lib/services/paymentMethodsService';

export function PaymentMethodsPage() {
  const { data, isLoading } = useQuery({
    queryKey: paymentMethodsKeys.list(),
    queryFn: () => listPaymentMethods(),
  });
  return (
    <section className="px-8 py-12 max-w-4xl mx-auto flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">PAYMENT METHODS</h1>
      {isLoading && <p className="text-ink-dim">Loading.</p>}
      {data && (
        <table className="w-full border border-line">
          <thead className="bg-bg-2 text-left text-sm font-display tracking-wider text-ink">
            <tr>
              <th className="px-4 py-2">Code</th>
              <th className="px-4 py-2">Label</th>
              <th className="px-4 py-2">Kind</th>
              <th className="px-4 py-2">Default</th>
            </tr>
          </thead>
          <tbody>
            {data.map((m) => (
              <tr key={m.id} className="border-t border-line">
                <td className="px-4 py-2 font-mono text-sm">{m.code}</td>
                <td className="px-4 py-2">{m.label}</td>
                <td className="px-4 py-2">{m.kind}</td>
                <td className="px-4 py-2">{m.default_for_org ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
