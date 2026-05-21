// PortalDashboardPage. Customer-portal landing.
//
// Path B3: the customer signs in via magic link and lands here. Renders:
//   - Welcome header with the customer.display_name
//   - Balance-due banner ("You owe $X across N open invoices") for the
//     immediate "what do I owe?" answer-on-page-load.
//   - Sign-out button so the customer can intentionally clear the session
//     (shared device, ended session).
//   - Invoices, Quotes, Projects sections with formatted dates, branded
//     status badges, and shared formatCents output. Each section handles
//     loading / empty / error states independently so a single failed
//     fetch does not blank the whole page.

import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { useAuth } from '@/auth/AuthContext';
import {
  usePortalMe,
  usePortalInvoices,
  usePortalQuotes,
  usePortalProjects,
} from '@/lib/hooks/useCrossCutting';
import { formatCents } from '@/lib/money';
import { formatDateMedium } from '@/lib/dates';
import { StatusBadge } from './components/StatusBadge';

interface PortalInvoiceRow {
  id: string;
  number: string;
  status: string;
  issued_at: string | null;
  due_at: string | null;
  total_cents: number | string;
  balance_cents: number | string;
  currency_code: string;
}

interface PortalQuoteRow {
  id: string;
  number: string;
  status: string;
  issued_at: string | null;
  expires_at: string | null;
  total_cents: number | string;
  currency_code: string;
}

interface PortalProjectRow {
  id: string;
  name: string;
  status: string;
  started_at: string | null;
  expected_completion_at: string | null;
}

function balanceSummary(rows: PortalInvoiceRow[]): {
  openCount: number;
  totalCents: number;
  currency: string;
} {
  const open = rows.filter(
    (r) => r.status !== 'paid' && r.status !== 'void',
  );
  const totalCents = open.reduce((acc, r) => {
    const n =
      typeof r.balance_cents === 'string'
        ? Number(r.balance_cents)
        : r.balance_cents;
    return acc + (Number.isFinite(n) ? n : 0);
  }, 0);
  const currency = rows[0]?.currency_code ?? 'USD';
  return { openCount: open.length, totalCents, currency };
}

export function PortalDashboardPage() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const me = usePortalMe();
  const invoices = usePortalInvoices({ enabled: me.data !== undefined });
  const quotes = usePortalQuotes({ enabled: me.data !== undefined });
  const projects = usePortalProjects({ enabled: me.data !== undefined });

  async function onSignOut() {
    await signOut();
    navigate('/portal/signin', { replace: true });
  }

  const invoiceRows = (invoices.data ?? []) as PortalInvoiceRow[];
  const quoteRows = (quotes.data ?? []) as PortalQuoteRow[];
  const projectRows = (projects.data ?? []) as PortalProjectRow[];
  const balance = balanceSummary(invoiceRows);

  return (
    <main className="min-h-screen bg-bg px-6 py-10">
      <header className="mx-auto mb-8 flex max-w-5xl items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-4xl tracking-wide text-ink">
            Welcome, {me.data?.display_name ?? '.'}
          </h1>
          <p className="text-sm text-ink-dim">Customer portal overview.</p>
        </div>
        <Button onClick={onSignOut} variant="secondary">
          Sign out
        </Button>
      </header>

      {/* Balance banner */}
      {invoices.isSuccess && (
        <div className="mx-auto mb-8 max-w-5xl border border-line bg-bg-2 px-6 py-4">
          {balance.openCount === 0 ? (
            <p className="font-sans text-sm text-ink-dim">
              No outstanding balance.
            </p>
          ) : (
            <p className="font-sans text-ink">
              You owe{' '}
              <span className="font-display text-2xl tracking-wide text-accent">
                {formatCents(balance.totalCents, balance.currency)}
              </span>{' '}
              across {balance.openCount}{' '}
              {balance.openCount === 1 ? 'open invoice' : 'open invoices'}.
            </p>
          )}
        </div>
      )}

      <div className="mx-auto flex max-w-5xl flex-col gap-10">
        {/* INVOICES */}
        <section>
          <h2 className="mb-3 font-display text-xl tracking-wider text-ink">
            INVOICES
          </h2>
          {invoices.isLoading ? (
            <p className="text-sm text-ink-dim">Loading invoices.</p>
          ) : invoices.isError ? (
            <ErrorRow onRetry={() => invoices.refetch()} />
          ) : invoiceRows.length === 0 ? (
            <EmptyRow message="No invoices yet. Your billing history will appear here." />
          ) : (
            <table className="w-full border border-line text-sm">
              <thead>
                <tr className="bg-bg-2 text-left text-ink-dim">
                  <th className="px-3 py-2">Number</th>
                  <th className="px-3 py-2">Issued</th>
                  <th className="px-3 py-2">Due</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {invoiceRows.map((inv) => (
                  <tr key={inv.id} className="border-t border-line">
                    <td className="px-3 py-2 font-mono text-ink">
                      {inv.number}
                    </td>
                    <td className="px-3 py-2 text-ink-dim">
                      {formatDateMedium(inv.issued_at)}
                    </td>
                    <td className="px-3 py-2 text-ink-dim">
                      {formatDateMedium(inv.due_at)}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={inv.status} />
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-ink">
                      {formatCents(inv.balance_cents, inv.currency_code)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* QUOTES */}
        <section>
          <h2 className="mb-3 font-display text-xl tracking-wider text-ink">
            QUOTES
          </h2>
          {quotes.isLoading ? (
            <p className="text-sm text-ink-dim">Loading quotes.</p>
          ) : quotes.isError ? (
            <ErrorRow onRetry={() => quotes.refetch()} />
          ) : quoteRows.length === 0 ? (
            <EmptyRow message="No quotes yet. Approved quotes that turn into projects will show up here." />
          ) : (
            <table className="w-full border border-line text-sm">
              <thead>
                <tr className="bg-bg-2 text-left text-ink-dim">
                  <th className="px-3 py-2">Number</th>
                  <th className="px-3 py-2">Issued</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {quoteRows.map((q) => (
                  <tr key={q.id} className="border-t border-line">
                    <td className="px-3 py-2 font-mono text-ink">{q.number}</td>
                    <td className="px-3 py-2 text-ink-dim">
                      {formatDateMedium(q.issued_at)}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={q.status} />
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-ink">
                      {formatCents(q.total_cents, q.currency_code)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* PROJECTS */}
        <section>
          <h2 className="mb-3 font-display text-xl tracking-wider text-ink">
            PROJECTS
          </h2>
          {projects.isLoading ? (
            <p className="text-sm text-ink-dim">Loading projects.</p>
          ) : projects.isError ? (
            <ErrorRow onRetry={() => projects.refetch()} />
          ) : projectRows.length === 0 ? (
            <EmptyRow message="No projects yet. Active jobs will appear here once they kick off." />
          ) : (
            <table className="w-full border border-line text-sm">
              <thead>
                <tr className="bg-bg-2 text-left text-ink-dim">
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Started</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Est. completion</th>
                </tr>
              </thead>
              <tbody>
                {projectRows.map((p) => (
                  <tr key={p.id} className="border-t border-line">
                    <td className="px-3 py-2 text-ink">{p.name}</td>
                    <td className="px-3 py-2 text-ink-dim">
                      {formatDateMedium(p.started_at)}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="px-3 py-2 text-ink-dim">
                      {formatDateMedium(p.expected_completion_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </main>
  );
}

function EmptyRow({ message }: { message: string }) {
  return (
    <p className="border border-dashed border-line px-4 py-6 text-center text-sm text-ink-dim">
      {message}
    </p>
  );
}

function ErrorRow({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between border border-line bg-bg-2 px-4 py-3">
      <p className="text-sm text-accent">
        Could not load this section. Try again.
      </p>
      <Button onClick={onRetry} variant="secondary" className="px-3 py-1 text-sm">
        Retry
      </Button>
    </div>
  );
}
