// CreditNoteDetailPage. Migration to the shared UI kit (F-Wave10-UI-KIT-01,
// 3PL CRUD tail): PageHeader + DetailLayout (HISTORY in the rail) replace the
// hand-rolled header and bottom-of-page history section. The Issue / Void
// lifecycle cluster moves into the main column (Void stays ghost weight behind
// the in-app confirm). The source-invoice link becomes the PageHeader meta.
//
// The credit-note FSM, the canFinanceTransition gates, the void
// destructiveConfirm, and the StateStepper are preserved verbatim. The apply
// flow stays a separate route; this page now surfaces an "Apply to invoice" CTA
// to it when the note is issued with a positive remaining balance and the
// caller holds credit_notes.apply (F-UIUX-CREDIT-NOTE-APPLY-CTA-01, the CTA
// portion of F-Wave10-CREDIT-NOTE-APPLY-FSM-01). The gate lives in
// creditNoteApplyGate.ts.

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
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { destructiveConfirm } from '@/lib/destructiveConfirm';
import { formatCents } from '@/lib/money';
import { LINK_CLASS } from '@/components/data/entityLabelStyles';
import { canApplyCreditNote } from './creditNoteApplyGate';
import {
  STATE_STEPPER_PATHS,
  isOffPath,
  nextStepperState,
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
  const { can } = useCapabilities();

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

  // F-UIUX-CREDIT-NOTE-APPLY-CTA-01: surface the apply route on the detail when
  // the note is issued with balance left and the caller can apply credit notes.
  const showApply =
    canApplyCreditNote(status, row.amount_cents, row.applied_cents) &&
    can('credit_notes.apply');

  // F-UIUX-RAIL-FIRST-EDGE-01 (Pattern D, UX-Q7 reopened): the rail's immediate
  // next happy-path step is interactive only for the SAFE FIRST EDGE
  // draft -> issued, which reuses the existing Issue mutation. The rail never
  // offers issued -> applied: that step is a navigate-to-apply Link (a separate
  // route, not a mutation), so it must never render as an inline advance. Gate
  // mirrors the Issue button (canIssue) plus the credit_notes.write cap the
  // server enforces with requireCap, and pins the next step to exactly
  // `issued`. The server stays the authority.
  const railNext = nextStepperState(
    STATE_STEPPER_PATHS.credit_note.path,
    row.status,
  );
  const canAdvanceRail =
    railNext === 'issued' && canIssue && can('credit_notes.write');
  const advance = () => issueMutation.mutate(creditNoteId);

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
      {/* UX-Q7 reopened (Pattern D): the rail's immediate next step is an
          interactive control ONLY for the safe first edge draft -> issued, which
          fires the same Issue mutation as the button below. It is never
          interactive for issued -> applied: that step is a navigate-to-apply
          Link, not a mutation. voided is the off-path sink. Past, current, and
          the terminal step stay display-only. */}
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
        onAdvance={canAdvanceRail ? advance : undefined}
        advancePending={transitionPending}
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
                  className={LINK_CLASS}
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
          {showApply && (
            <Link
              to={`/invoicing/credit-notes/${creditNoteId}/apply`}
              className="px-5 py-2.5 font-sans font-medium tracking-wide transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent bg-accent text-ink hover:bg-accent-bright"
            >
              Apply to invoice
            </Link>
          )}
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
      <p className="text-xl tabular-nums text-ink break-words">{value}</p>
    </div>
  );
}
