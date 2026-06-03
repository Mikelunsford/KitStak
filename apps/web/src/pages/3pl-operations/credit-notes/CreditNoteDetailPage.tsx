// CreditNoteDetailPage. Migration to the shared UI kit (F-Wave10-UI-KIT-01,
// 3PL CRUD tail): PageHeader + DetailLayout (HISTORY in the rail) replace the
// hand-rolled header and bottom-of-page history section. The Issue / Void
// lifecycle cluster moves into the main column (Void stays ghost weight behind
// the in-app confirm). The source-invoice link becomes the PageHeader meta.
//
// The credit-note FSM, the canFinanceTransition gates, the void
// destructiveConfirm, and the StateStepper are preserved verbatim. The apply
// flow stays a separate route and is intentionally untouched here
// (F-Wave10-CREDIT-NOTE-APPLY-FSM-01 owns the apply CTA / status gating).

import { Link, useParams } from 'react-router-dom';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import { StateStepper } from '@/components/shell/StateStepper';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { DetailLayout } from '@/components/ui/DetailLayout';
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
    <section className="mx-auto flex max-w-5xl flex-col gap-6 px-8 py-12">
      <Breadcrumbs
        items={[
          { label: 'Credit notes', to: '/invoicing/credit-notes' },
          { label: row.credit_note_number },
        ]}
      />
      {/* UX-Q7: display-only horizontal progress stepper. voided is the
          off-path sink. */}
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
      <PageHeader
        title={row.credit_note_number}
        meta={
          sourceInvoiceId ? (
            <span>
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
            </span>
          ) : undefined
        }
      />

      <DetailLayout
        rail={
          <section>
            <h2 className="mb-3 text-2xl font-display tracking-wide text-ink">
              HISTORY
            </h2>
            <AuditTimeline entityType="credit_note" entityId={creditNoteId} />
          </section>
        }
      >
        {/* Lifecycle actions. Issue moves draft -> issued at primary weight;
            Void is destructive (draft|issued -> voided) so it sits at ghost
            weight behind the in-app confirm modal. Both hide once the FSM no
            longer permits the move. */}
        <div className="flex flex-wrap items-start gap-2">
          {canIssue && (
            <Button
              onClick={() => issueMutation.mutate(creditNoteId)}
              disabled={transitionPending}
            >
              {issueMutation.isPending ? 'Issuing.' : 'Issue'}
            </Button>
          )}
          {canVoid && (
            <Button variant="ghost" onClick={onVoid} disabled={transitionPending}>
              Void
            </Button>
          )}
        </div>

        {(issueMutation.error || voidMutation.error) && (
          <p className="font-sans text-sm text-accent">
            {(issueMutation.error instanceof Error &&
              issueMutation.error.message) ||
              (voidMutation.error instanceof Error &&
                voidMutation.error.message) ||
              'Action failed.'}
          </p>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Stat
            label="Amount"
            value={formatCents(
              row.amount_cents as number | string,
              row.currency_code,
            )}
          />
          <Stat
            label="Applied"
            value={formatCents(
              row.applied_cents as number | string,
              row.currency_code,
            )}
          />
          <Stat label="Reason" value={row.reason ?? '-'} />
        </div>
      </DetailLayout>
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
