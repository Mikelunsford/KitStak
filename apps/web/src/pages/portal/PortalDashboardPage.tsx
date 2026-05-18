// PortalDashboardPage. Customer-portal landing.
//
// Renders the caller customer's invoices, quotes, and projects in three
// stacked sections. Read-only.

import { Link } from 'react-router-dom';

import {
  usePortalMe,
  usePortalInvoices,
  usePortalQuotes,
  usePortalProjects,
} from '@/lib/hooks/useCrossCutting';

function centsToString(v: number | string): string {
  if (typeof v === 'number') return (v / 100).toFixed(2);
  // String case: keep precision.
  const negative = v.startsWith('-');
  const digits = negative ? v.slice(1) : v;
  const padded = digits.padStart(3, '0');
  const intPart = padded.slice(0, -2);
  const fracPart = padded.slice(-2);
  return `${negative ? '-' : ''}${intPart}.${fracPart}`;
}

export function PortalDashboardPage() {
  const me = usePortalMe();
  const invoices = usePortalInvoices({ enabled: me.data !== undefined });
  const quotes = usePortalQuotes({ enabled: me.data !== undefined });
  const projects = usePortalProjects({ enabled: me.data !== undefined });

  return (
    <main className="min-h-screen bg-bg px-6 py-10">
      <header className="mx-auto mb-8 flex max-w-5xl flex-col gap-1">
        <h1 className="font-display text-4xl tracking-wide text-ink">
          {me.data ? me.data.display_name : 'Portal'}
        </h1>
        <p className="text-sm text-ink-dim">Customer portal overview.</p>
      </header>

      <div className="mx-auto flex max-w-5xl flex-col gap-8">
        <section>
          <h2 className="mb-2 font-display text-xl tracking-wider text-ink">
            INVOICES
          </h2>
          {invoices.isLoading ? (
            <p className="text-sm text-ink-dim">Loading.</p>
          ) : (invoices.data ?? []).length === 0 ? (
            <p className="text-sm text-ink-dim">No invoices yet.</p>
          ) : (
            <table className="w-full border border-line text-sm">
              <thead>
                <tr className="bg-bg-2 text-left">
                  <th className="px-3 py-2">Number</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Due</th>
                  <th className="px-3 py-2 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {(invoices.data ?? []).map((inv) => (
                  <tr key={inv.id} className="border-t border-line">
                    <td className="px-3 py-2">
                      <Link
                        to={`/portal/invoices/${inv.id}`}
                        className="text-ink underline-offset-2 hover:underline"
                      >
                        {inv.number}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-ink-dim">{inv.status}</td>
                    <td className="px-3 py-2 text-ink-dim">{inv.due_at ?? '.'}</td>
                    <td className="px-3 py-2 text-right text-ink">
                      {centsToString(inv.balance_cents)} {inv.currency_code}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section>
          <h2 className="mb-2 font-display text-xl tracking-wider text-ink">
            QUOTES
          </h2>
          {quotes.isLoading ? (
            <p className="text-sm text-ink-dim">Loading.</p>
          ) : (quotes.data ?? []).length === 0 ? (
            <p className="text-sm text-ink-dim">No quotes yet.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {(quotes.data ?? []).map((q) => (
                <li key={q.id} className="flex items-center justify-between border border-line px-3 py-2 text-sm">
                  <Link to={`/portal/quotes/${q.id}`} className="text-ink hover:underline">
                    {q.number}
                  </Link>
                  <span className="text-ink-dim">{q.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-2 font-display text-xl tracking-wider text-ink">
            PROJECTS
          </h2>
          {projects.isLoading ? (
            <p className="text-sm text-ink-dim">Loading.</p>
          ) : (projects.data ?? []).length === 0 ? (
            <p className="text-sm text-ink-dim">No projects yet.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {(projects.data ?? []).map((p) => (
                <li key={p.id} className="flex items-center justify-between border border-line px-3 py-2 text-sm">
                  <Link to={`/portal/projects/${p.id}`} className="text-ink hover:underline">
                    {p.name}
                  </Link>
                  <span className="text-ink-dim">{p.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
