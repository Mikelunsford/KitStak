import { Link, useParams } from 'react-router-dom';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import { StateStepper } from '@/components/shell/StateStepper';
import { Button } from '@/components/ui/Button';
import {
  useCreditNote,
  useIssueCreditNote,
  useVoidCreditNote,
} from '@/lib/hooks/useCreditNotes';
import { useInvoice } from '@/lib/hooks/useInvoices';
import { destructiveConfirm } from '@/lib/destructiveConfirm';
import { formatCents } from '@/lib/money';
import {
  STATE_STEPPER_PATHS,
  isOffPath,
} from '@/lib/workflow/stateStepperPaths';
import {
  creditNoteStateMachine,
  canFinanceTransition,
  type CreditNoteState,
} from '@/lib/workflow/finance';

/**
 * CreditNoteDetailPage. Header with amount, applied, reason, source invoice.
 * Closes G-CN-DETAIL-01 by surfacing a link back to the source invoice when
 * one is attached. If the invoice id is set but the fetch fails (RLS scope
 * change, deleted invoice), the label degrades to "not found" rather than
 * blocking the page.
 */
export function CreditNoteDetailPage() {
  const { id } = useParams();
  const creditNoteId = id ?? '';
  const cn = useCreditNote(creditNoteId);
  const sourceInvoiceId = cn.data?.source_invoice_id ?? null;
  const sourceInvoice = useInvoice(sourceInvoiceId ?? '');
  const issueMutation = useIssueCreditNote();
  const voidMutation = useVoidCreditNote();

  if (!creditNoteId) return <p>Missing credit note id.</p>;
  if (cn.isLoading) return <p className="px-8 py-8">Loading.</p>;
  if (cn.error || !cn.data)
    return <p className="px-8 py-8 text-accent">Credit note not found.</p>;
  const row = cn.data;

  // Gate the lifecycle buttons on the FSM so an invalid transition never
  // renders, matching how the invoice detail page hides Send / Cancel. The
  // server is still the authority (409 STATE_CONFLICT on an illegal move).
  // canFinanceTransition treats a same-state move as allowed, so we exclude
  // status === target to keep Issue / Void hidden once the note has already
  // reached that state (the backend rejects the self-loop with 409 too).
  const status = row.status as CreditNoteState;
  const canIssue =
    status !== 'issued' &&
    canFinanceTransition(creditNoteStateMachine, status, 'issued');
  const canVoid =
    status !== 'voided' &&
    canFinanceTransition(creditNoteStateMachine, status, 'voided');
  const transitionPending = issueMutation.isPending || voidMutation.isPending;

  const onVoid = async () => {
    if (
      !(await destructiveConfirm({
        action: 'Void this credit note',
        consequence:
          'The credit note will move to voided and can no longer be issued or applied.',
        irreversible: true,
      }))
    )
      return;
    voidMutation.mutate(creditNoteId);
  };

  return (
    <section className="px-8 py-8 flex flex-col gap-8">
      <Breadcrumbs
        items={[
          { label: 'Credit notes', to: '/invoicing/credit-notes' },
          { label: row.credit_note_number },
        ]}
      />
      {/* UX-Q7: display-only horizontal progress stepper. Replaces the
          "Status: <status>" line. voided is the off-path sink. */}
      <StateStepper
        steps={[...STATE_STEPPER_PATHS.credit_note.path]}
        current={row.status}
        offPath={
          isOffPath('credit_note', row.status)
            ? {
                state: row.status,
                label: STATE_STEPPER_PATHS.credit_note.resolveLabel(row.status),
              }
            : undefined
        }
      />
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase text-ink-dim font-sans">Credit note</p>
          <h1 className="text-4xl font-display tracking-wide text-ink">
            {row.credit_note_number}
          </h1>
          {sourceInvoiceId && (
            <p className="font-sans text-sm text-ink-dim mt-2">
              Source invoice:{' '}
              {sourceInvoice.isLoading ? (
                <span>Loading.</span>
              ) : sourceInvoice.data ? (
                <Link
                  to={`/invoicing/invoices/${sourceInvoiceId}`}
                  className="text-accent underline"
                >
                  {sourceInvoice.data.invoice_number}
                </Link>
              ) : (
                <span>not found</span>
              )}
            </p>
          )}
        </div>
        {/* Lifecycle actions. Issue moves draft -> issued at primary weight;
            Void is destructive (draft|issued -> voided) so it sits at ghost
            weight behind the in-app confirm modal. Both hide once the FSM no
            longer permits the move. */}
        <div className="flex gap-2 flex-wrap items-start">
          {canIssue && (
            <Button
              onClick={() => issueMutation.mutate(creditNoteId)}
              disabled={transitionPending}
            >
              {issueMutation.isPending ? 'Issuing.' : 'Issue'}
            </Button>
          )}
          {canVoid && (
            <Button
              variant="ghost"
              onClick={onVoid}
              disabled={transitionPending}
            >
              Void
            </Button>
          )}
        </div>
      </header>

      {(issueMutation.error || voidMutation.error) && (
        <p className="font-sans text-sm text-accent">
          {(issueMutation.error instanceof Error && issueMutation.error.message) ||
            (voidMutation.error instanceof Error && voidMutation.error.message) ||
            'Action failed.'}
        </p>
      )}

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
