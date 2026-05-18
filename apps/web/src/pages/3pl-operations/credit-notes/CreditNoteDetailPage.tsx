import { useParams } from 'react-router-dom';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { useCreditNote } from '@/lib/hooks/useCreditNotes';
import { formatCents } from '@/lib/money';

/**
 * CreditNoteDetailPage. Header with amount, applied, reason, source invoice.
 */
export function CreditNoteDetailPage() {
  const { id } = useParams();
  const creditNoteId = id ?? '';
  const cn = useCreditNote(creditNoteId);

  if (!creditNoteId) return <p>Missing credit note id.</p>;
  if (cn.isLoading) return <p className="px-8 py-8">Loading.</p>;
  if (cn.error || !cn.data)
    return <p className="px-8 py-8 text-accent">Credit note not found.</p>;
  const row = cn.data;

  return (
    <section className="px-8 py-8 flex flex-col gap-8">
      <header>
        <p className="text-xs uppercase text-ink-dim font-sans">Credit note</p>
        <h1 className="text-4xl font-display tracking-wide text-ink">
          {row.credit_note_number}
        </h1>
        <p className="text-ink-dim font-sans uppercase text-xs mt-1">
          Status: {row.status}
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Stat label="Amount" value={formatCents(row.amount_cents as number | string, row.currency_code)} />
        <Stat label="Applied" value={formatCents(row.applied_cents as number | string, row.currency_code)} />
        <Stat label="Reason" value={row.reason ?? '-'} />
      </div>

      <section>
        <h2 className="text-2xl font-display tracking-wide text-ink mb-3">HISTORY</h2>
        <AuditTimeline entityType="credit_note" entityId={creditNoteId} />
      </section>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg-2 border border-line p-4">
      <p className="text-xs uppercase text-ink-dim font-sans">{label}</p>
      <p className="text-xl font-mono text-ink break-words">{value}</p>
    </div>
  );
}
