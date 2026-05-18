import { useParams } from 'react-router-dom';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import {
  useJournalEntry,
  usePostJournalEntry,
} from '@/lib/hooks/useJournalEntries';
import { formatCents } from '@/lib/money';

/**
 * JournalEntryDetailPage. Header, lines, balance summary. Post action is
 * server-guarded by check_journal_balance + period_closed trigger.
 */
export function JournalEntryDetailPage() {
  const { id } = useParams();
  const jeId = id ?? '';
  const detail = useJournalEntry(jeId);
  const post = usePostJournalEntry();

  if (!jeId) return <p>Missing journal entry id.</p>;
  if (detail.isLoading) return <p className="px-8 py-8">Loading.</p>;
  if (detail.error || !detail.data)
    return <p className="px-8 py-8 text-accent">Entry not found.</p>;

  const { entry, lines } = detail.data;
  const canPost = entry.status === 'draft';
  const totalDebit = lines.reduce(
    (acc, l) => acc + Number(l.debit_cents),
    0,
  );
  const totalCredit = lines.reduce(
    (acc, l) => acc + Number(l.credit_cents),
    0,
  );

  return (
    <section className="px-8 py-8 flex flex-col gap-8">
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase text-ink-dim font-sans">Journal entry</p>
          <h1 className="text-4xl font-display tracking-wide text-ink">
            {entry.entry_number}
          </h1>
          <p className="text-ink-dim font-sans uppercase text-xs mt-1">
            Status: {entry.status} · Period {entry.period_year}-
            {String(entry.period_month).padStart(2, '0')}
          </p>
        </div>
        {canPost && (
          <button
            type="button"
            className="px-4 py-2 bg-accent text-on-primary font-display tracking-wider text-sm disabled:opacity-50"
            onClick={() => post.mutate(jeId)}
            disabled={post.isPending}
          >
            POST
          </button>
        )}
      </header>

      {post.error && (
        <p className="text-accent font-sans text-sm">
          {(post.error as Error).message}
        </p>
      )}

      <section>
        <h2 className="text-2xl font-display tracking-wide text-ink mb-3">LINES</h2>
        <table className="w-full text-sm font-sans border-collapse">
          <thead>
            <tr className="text-left text-ink-dim border-b border-line">
              <th className="py-2">Account</th>
              <th className="py-2 text-right">Debit</th>
              <th className="py-2 text-right">Credit</th>
              <th className="py-2">Memo</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b border-line">
                <td className="py-2 font-mono text-xs">{l.account_id}</td>
                <td className="py-2 text-right">{formatCents(l.debit_cents as number | string, 'USD')}</td>
                <td className="py-2 text-right">{formatCents(l.credit_cents as number | string, 'USD')}</td>
                <td className="py-2 text-ink-dim">{l.memo ?? ''}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line font-display text-ink">
              <td className="py-2">TOTAL</td>
              <td className="py-2 text-right">{formatCents(totalDebit, 'USD')}</td>
              <td className="py-2 text-right">{formatCents(totalCredit, 'USD')}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </section>

      <section>
        <h2 className="text-2xl font-display tracking-wide text-ink mb-3">HISTORY</h2>
        <AuditTimeline entityType="journal_entry" entityId={jeId} />
      </section>
    </section>
  );
}
