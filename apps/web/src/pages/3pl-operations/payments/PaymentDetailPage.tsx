// PaymentDetailPage (Wave 15). Read-only payment detail shell mirroring
// CreditNoteDetailPage (Breadcrumbs + PageHeader + DetailLayout with the
// HISTORY rail + a stat grid + a CTA cluster). Payments have NO state machine,
// so there is no StateStepper and no FSM gating. "Apply to invoice" surfaces
// only when unapplied_cents > 0 and the caller can apply; Delete is the sole
// correction primitive for a mis-keyed payment (no FSM cancel exists) and sits
// at ghost weight behind the in-app confirm.

import { Link, useNavigate, useParams } from 'react-router-dom';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { DetailLayout } from '@/components/ui/DetailLayout';
import { usePayment, useDeletePayment } from '@/lib/hooks/usePayments';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { destructiveConfirm } from '@/lib/destructiveConfirm';
import { formatCents } from '@/lib/money';

export function PaymentDetailPage() {
  const { id } = useParams();
  const paymentId = id ?? '';
  const payment = usePayment(paymentId);
  const del = useDeletePayment();
  const { can } = useCapabilities();
  const navigate = useNavigate();

  if (!paymentId) return <p>Missing payment id.</p>;
  if (payment.isLoading) return <p className="px-8 py-8">Loading.</p>;
  if (payment.error || !payment.data)
    return <p className="px-8 py-8 text-accent">Payment not found.</p>;
  const row = payment.data;

  // Apply is a separate route, surfaced only when there is cash left to allocate
  // and the caller can apply. unapplied_cents is a number|string union, so coerce.
  const showApply = Number(row.unapplied_cents) > 0 && can('payments.apply');

  const onDelete = async () => {
    if (
      !(await destructiveConfirm({
        action: 'Delete this payment',
        consequence:
          'The payment and its allocations will be removed from the ledger.',
        irreversible: true,
      }))
    )
      return;
    del.mutate(paymentId, { onSuccess: () => navigate('/invoicing/payments') });
  };

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-6 px-8 py-12">
      <Breadcrumbs
        items={[
          { label: 'Payments', to: '/invoicing/payments' },
          { label: row.payment_number },
        ]}
      />
      <PageHeader
        title={row.payment_number}
        meta={<span>Received {new Date(row.received_at).toLocaleDateString()}</span>}
      />

      <DetailLayout
        rail={
          <section>
            <h2 className="mb-3 text-2xl font-display tracking-wide text-ink">
              HISTORY
            </h2>
            <AuditTimeline entityType="payment" entityId={paymentId} />
          </section>
        }
      >
        <div className="flex flex-wrap items-start gap-2">
          {showApply && (
            <Link
              to={`/invoicing/payments/${paymentId}/apply`}
              className="px-5 py-2.5 font-sans font-medium tracking-wide transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent bg-accent text-ink hover:bg-accent-bright"
            >
              Apply to invoice
            </Link>
          )}
          {can('payments.delete') && (
            <Button variant="ghost" onClick={onDelete} disabled={del.isPending}>
              {del.isPending ? 'Deleting.' : 'Delete'}
            </Button>
          )}
        </div>

        {del.error && (
          <p className="font-sans text-sm text-accent">
            {del.error instanceof Error ? del.error.message : 'Delete failed.'}
          </p>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Stat label="Amount" value={formatCents(row.amount_cents, row.currency_code)} />
          <Stat
            label="Unapplied"
            value={formatCents(row.unapplied_cents, row.currency_code)}
          />
          <Stat label="Method" value={row.payment_method ?? '-'} />
          <Stat label="Reference" value={row.reference_number ?? '-'} />
          <Stat
            label="Received"
            value={new Date(row.received_at).toLocaleDateString()}
          />
          <Stat label="Notes" value={row.notes ?? '-'} />
        </div>
      </DetailLayout>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg-2 border border-line p-4">
      <p className="text-xs uppercase text-ink-dim font-sans">{label}</p>
      <p className="text-xl tabular-nums text-ink break-words">{value}</p>
    </div>
  );
}
