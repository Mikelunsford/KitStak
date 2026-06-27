// JournalEntryDetailPage. Finance. Migration to the shared UI kit
// (F-Wave10-UI-KIT-01): PageHeader (status as a StatusBadge in the meta) +
// DetailLayout (HISTORY in the rail) replace the hand-rolled header, raw status
// text, and bottom history section. journal_entry is NOT registered in
// STATE_STEPPER_PATHS, so there is no StateStepper (matching Co-Pack). The Post
// action moves to the kit Button. The debit/credit lines table stays
// hand-rolled (it has a balance tfoot); money keeps formatCents and the
// integer-safe debit/credit accumulation. canPost (status === 'draft') is
// preserved verbatim.

import { useParams } from 'react-router-dom';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import { EntityLabel } from '@/components/data/EntityLabel';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { DetailLayout } from '@/components/ui/DetailLayout';
import { StatusBadge } from '@/components/ui/StatusBadge';
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
  const totalDebit = lines.reduce((acc, l) => acc + Number(l.debit_cents), 0);
  const totalCredit = lines.reduce((acc, l) => acc + Number(l.credit_cents), 0);

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-6 px-8 py-12">
      <Breadcrumbs
        items={[
          { label: 'Journal entries', to: '/finance/journal-entries' },
          { label: entry.entry_number },
        ]}
      />
      <PageHeader
        title={entry.entry_number}
        meta={
          <span className="flex items-center gap-2">
            <StatusBadge status={entry.status} />
            <span>
              Period {entry.period_year}-
              {String(entry.period_month).padStart(2, '0')}
            </span>
          </span>
        }
      />

      <DetailLayout
        rail={
          <section>
            <h2 className="mb-3 text-2xl font-display tracking-wide text-ink">
              HISTORY
            </h2>
            <AuditTimeline entityType="journal_entry" entityId={jeId} />
          </section>
        }
      >
        {canPost && (
          <div>
            <Button
              variant="secondary"
              onClick={() => post.mutate(jeId)}
              disabled={post.isPending}
            >
              {post.isPending ? 'Posting.' : 'Post'}
            </Button>
          </div>
        )}
        {post.error && (
          <p className="text-accent font-sans text-sm">
            {(post.error as Error).message}
          </p>
        )}

        <section>
          <h2 className="text-2xl font-display tracking-wide text-ink mb-3">
            LINES
          </h2>
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
                  <td className="py-2 font-mono text-xs">
                    <EntityLabel kind="ledger_account" id={l.account_id} />
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {formatCents(l.debit_cents as number | string, 'USD')}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {formatCents(l.credit_cents as number | string, 'USD')}
                  </td>
                  <td className="py-2 text-ink-dim">{l.memo ?? ''}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line font-display text-ink">
                <td className="py-2">TOTAL</td>
                <td className="py-2 text-right tabular-nums">
                  {formatCents(totalDebit, 'USD')}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {formatCents(totalCredit, 'USD')}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </section>
      </DetailLayout>
    </section>
  );
}
