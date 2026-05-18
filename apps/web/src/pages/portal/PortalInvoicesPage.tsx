// PortalInvoicesPage. Standalone listing if the customer wants the full set.

import { Link } from 'react-router-dom';
import { usePortalInvoices } from '@/lib/hooks/useCrossCutting';

export function PortalInvoicesPage() {
  const query = usePortalInvoices();
  return (
    <main className="min-h-screen bg-bg px-6 py-10">
      <h1 className="mx-auto mb-6 max-w-5xl font-display text-3xl tracking-wide text-ink">
        INVOICES
      </h1>
      <div className="mx-auto max-w-5xl">
        {query.isLoading ? (
          <p className="text-sm text-ink-dim">Loading.</p>
        ) : (query.data ?? []).length === 0 ? (
          <p className="text-sm text-ink-dim">No invoices yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {(query.data ?? []).map((inv) => (
              <li
                key={inv.id}
                className="flex items-center justify-between border border-line px-3 py-2 text-sm"
              >
                <Link to={`/portal/invoices/${inv.id}`} className="text-ink hover:underline">
                  {inv.number}
                </Link>
                <span className="text-ink-dim">{inv.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
