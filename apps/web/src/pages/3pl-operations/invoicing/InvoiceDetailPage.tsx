import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import { fallbackLabel } from '@/components/shell/breadcrumbFallback';
import { NextStepCTA } from '@/components/shell/NextStepCTA';
import { StateStepper } from '@/components/shell/StateStepper';
import {
  STATE_STEPPER_PATHS,
  isOffPath,
} from '@/lib/workflow/stateStepperPaths';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { PageHeader } from '@/components/ui/PageHeader';
import { DetailLayout } from '@/components/ui/DetailLayout';
import { BillableLineItemsEditor } from '@/components/ui/BillableLineItemsEditor';
import {
  useInvoice,
  useInvoiceLineItems,
  useCreateInvoiceLineItem,
  useUpdateInvoiceLineItem,
  useDeleteInvoiceLineItem,
  useSendInvoice,
  useCancelInvoice,
} from '@/lib/hooks/useInvoices';
import { useCustomer } from '@/lib/hooks/useCustomer';
import { useProject } from '@/lib/hooks/useProjects';
import { useQuote } from '@/lib/hooks/useQuotes';
import { usePayments } from '@/lib/hooks/usePayments';
import { useMe } from '@/lib/hooks/useMe';
import { useEntityAuditStates } from '@/lib/hooks/useEntityAuditStates';
import { hasCap } from '@/lib/capabilities';
import { renderPdf } from '@/lib/services/pdfService';
import { formatCents, roundHalfEven } from '@/lib/money';
import { destructiveConfirm } from '@/lib/destructiveConfirm';
import { shouldShowInvoiceNextStepCTA } from '@/lib/workflow/nextStepCTA';
import {
  computeSendButtonFeedback,
  SEND_FEEDBACK_COPY,
} from '@/lib/workflow/sendButtonFeedback';
import {
  isPdfDisabledForDraft,
  PDF_DRAFT_DISABLED_TOOLTIP,
} from '@/lib/workflow/pdfGating';
// PR-D / BNEW-3-INV: item-pick prefill helper extracted to
// applyItemSelectionToInvoiceLine.ts for the same reason PR-C extracted the
// quote-side helper — pure function, unit-testable, closes the async-stale
// race in the previous synchronous handler.
import { applyItemSelectionToInvoiceLine } from './applyItemSelectionToInvoiceLine';
import { ReceivePaymentModal } from './ReceivePaymentModal';

/**
 * InvoiceDetailPage. Closes G-INV-DETAIL-01 and G-PAY-FLOW-01. Adds
 * customer / project / quote breadcrumbs, add-line form, payments section,
 * and a "Receive payment" CTA that pre-fills customer + invoice on the
 * PaymentCreatePage.
 */
export function InvoiceDetailPage() {
  const { id } = useParams();
  const invoiceId = id ?? '';
  const invoice = useInvoice(invoiceId);
  const lines = useInvoiceLineItems(invoiceId);
  const addLine = useCreateInvoiceLineItem(invoiceId);
  const updateLine = useUpdateInvoiceLineItem(invoiceId);
  const deleteLine = useDeleteInvoiceLineItem(invoiceId);
  const sendMutation = useSendInvoice();
  const cancelMutation = useCancelInvoice();

  const customerId = invoice.data?.customer_id ?? null;
  const projectId = invoice.data?.project_id ?? null;
  const sourceQuoteId = invoice.data?.quote_id ?? null;

  const customer = useCustomer(customerId ?? undefined);
  const project = useProject(projectId ?? undefined);
  const sourceQuote = useQuote(sourceQuoteId ?? undefined);
  // BNEW-12: scope the PAYMENTS section to allocations against THIS
  // invoice, not all payments from this customer. The 2026-05-22 v2
  // re-smoke surfaced that a brand-new DRAFT invoice for Smoke V2 Co.
  // with $0 balance and zero allocations was rendering yesterday's
  // SV2-PAY-001/SV2-PAY-002 under PAYMENTS with "unapplied $0.00",
  // because the query filtered by customer_id only. The customer-wide
  // payments list still lives on CustomerDetailPage; this page now
  // honors what the section header has always implied.
  const payments = usePayments(
    invoiceId ? { invoice_id: invoiceId } : {},
  );
  // F-Wave9-COWORK-SMOKE-07: visited-states feed for the stepper. Reads
  // audit_log so steps before the current one only render as past if the
  // entity actually transitioned through them. The invoice FSM allows
  // `draft -> sent` directly (skipping pending), so without this feed the
  // stepper coloured PENDING as completed even though audit_log only
  // recorded the direct edge.
  const auditStates = useEntityAuditStates('invoice', invoiceId || null);

  // Add-line field state lives at the page level so the mutation
  // onSuccess can clear it. The BillableLineItemsEditor owns the
  // show/hide chrome and the ItemPicker, and pipes the chosen item
  // back via `onItemPicked` so the page can apply its own prefill.
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [lineDesc, setLineDesc] = useState('');
  const [lineQty, setLineQty] = useState('1');
  const [linePrice, setLinePrice] = useState('0');
  // Inline invoice-line edit. The invoice line encoding differs from the quote:
  // decimal `quantity`, flat `discount_cents`, decimal-fraction
  // `tax_rate_snapshot` (0.0825 = 8.25%), and `unit_price_cents` in cents. These
  // fields are the trusted inputs; the invoicing handler re-derives
  // tax_amount_cents and line_total_cents server-side (A1), so the SPA never
  // sends totals. Reuses the page's own TextInput primitives, not the quote
  // editor.
  const [editLineId, setEditLineId] = useState<string | null>(null);
  const [editDesc, setEditDesc] = useState('');
  const [editQty, setEditQty] = useState('1');
  const [editPrice, setEditPrice] = useState('0');
  const [editTaxRate, setEditTaxRate] = useState('0');
  const [editDiscount, setEditDiscount] = useState('0');
  const [pdfPending, setPdfPending] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  // F-Wave9-AUDIT-V3-WAVE-F-01: inline Receive Payment modal. Replaces
  // the navigate-to-PaymentCreatePage flow so the operator stays on
  // the invoice detail page.
  const [showReceivePayment, setShowReceivePayment] = useState(false);

  const me = useMe({ enabled: true });
  const canRenderPdf = me.data?.active_role
    ? hasCap(me.data.active_role, 'pdf.document.render')
    : false;

  // PR-F: pre-fill now happens synchronously inside the picker's onChange
  // handler below (ItemPicker emits the matched record alongside the id).
  // The previous useItem(id) + useEffect plumbing introduced a visible
  // flash — id landed one render before description/price did — and the
  // dropdown already has the matched record in scope at click time.
  // applyItemSelectionToInvoiceLine still owns the field-population shape
  // so the existing unit test continues to lock the contract.

  if (!invoiceId) return <p>Missing invoice id.</p>;
  if (invoice.isLoading) return <p className="px-8 py-8">Loading.</p>;
  if (invoice.error || !invoice.data)
    return <p className="px-8 py-8 text-accent">Invoice not found.</p>;

  const inv = invoice.data;
  const canSend = inv.status === 'draft' || inv.status === 'pending';
  const canCancel = ['draft', 'pending', 'sent', 'on_hold'].includes(inv.status);
  const canEditLines = inv.status === 'draft';
  // UX-Q4: source-of-truth predicate lives in `@/lib/workflow/nextStepCTA`
  // so the regression test locks the trigger state set.
  const canReceivePayment = shouldShowInvoiceNextStepCTA(inv.status);

  const onAddLine = (e: FormEvent) => {
    e.preventDefault();
    const qtyNum = Number(lineQty);
    const priceNum = Number(linePrice);
    // A3 (WS-A MONEY INTEGRITY): banker's rounding on money. This prefill is
    // a display convenience; the invoicing handler server-recomputes the
    // persisted line_total_cents (A1).
    const lineTotal = String(roundHalfEven(qtyNum * priceNum));
    // F-Wave7-MUTATION-ERRORS-SWEEP-01: mutate(input, { onSuccess }) so a
    // 4xx surfaces in the inline error renderer below the form.
    addLine.mutate(
      {
        description: lineDesc,
        quantity: lineQty,
        unit_price_cents: linePrice,
        line_total_cents: lineTotal,
        ...(selectedItemId ? { item_id: selectedItemId } : {}),
      },
      {
        onSuccess: () => {
          setSelectedItemId(null);
          setLineDesc('');
          setLineQty('1');
          setLinePrice('0');
        },
      },
    );
  };

  const beginEditLine = (l: {
    id: string;
    description: string;
    quantity: number | string;
    unit_price_cents: number | string;
    tax_rate_snapshot: number | string;
    discount_cents: number | string;
  }) => {
    setEditLineId(l.id);
    setEditDesc(l.description);
    setEditQty(String(l.quantity));
    setEditPrice(String(l.unit_price_cents));
    setEditTaxRate(String(l.tax_rate_snapshot));
    setEditDiscount(String(l.discount_cents));
  };

  const cancelEditLine = () => {
    setEditLineId(null);
    updateLine.reset();
  };

  const onSaveLine = (e: FormEvent) => {
    e.preventDefault();
    if (!editLineId) return;
    // The handler server-recomputes tax_amount_cents + line_total_cents from
    // these trusted inputs (A1), so the SPA never sends totals.
    updateLine.mutate(
      {
        lineId: editLineId,
        body: {
          description: editDesc,
          quantity: editQty,
          unit_price_cents: editPrice,
          tax_rate_snapshot: editTaxRate,
          discount_cents: editDiscount,
        },
      },
      {
        onSuccess: () => {
          setEditLineId(null);
        },
      },
    );
  };

  // F-Wave9-AUDIT-V3-WAVE-F-01: open the inline modal rather than
  // navigating to PaymentCreatePage. The mutations the modal fires
  // already invalidate the invoice + payments query trees on success,
  // so the PAYMENTS section below refreshes automatically.
  const onReceivePayment = () => setShowReceivePayment(true);

  // F-Wave2-CO-01. Build the invoice render payload from the loaded invoice
  // and its line items, call the pdf-worker, and trigger a download via a
  // hidden anchor. The worker returns a data URL so no Storage round-trip
  // is involved.
  const onDownloadPdf = async () => {
    setPdfError(null);
    setPdfPending(true);
    try {
      const result = await renderPdf('invoice', {
        customer_display_name: customer.data?.display_name ?? '',
        invoice_number: inv.invoice_number,
        issue_date: inv.issue_date ?? '',
        due_date: inv.due_date ?? '',
        lines: (lines.data ?? []).map((l) => ({
          description: l.description,
          quantity: String(l.quantity),
          unit_price_cents: String(l.unit_price_cents),
          line_total_cents: String(l.line_total_cents),
        })),
        subtotal_cents: String(inv.subtotal_cents),
        tax_cents: String(inv.tax_total_cents),
        total_cents: String(inv.total_cents),
        currency: inv.currency_code,
      });
      if ('not_available' in result) {
        setPdfError(result.message);
        return;
      }
      const a = document.createElement('a');
      a.href = result.url;
      a.download = `invoice-${inv.invoice_number}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : 'Download failed.');
    } finally {
      setPdfPending(false);
    }
  };

  // BNEW-12: the list is already scoped server-side via
  // ?invoice_id=<this-invoice>, so no client-side filter is required.
  // Each row in the response has at least one allocation against this
  // invoice; the row's amount_cents reflects the full payment amount
  // (one payment may spread across many invoices). Showing the
  // per-allocation amount would require returning the allocation
  // shape alongside the payment header; deferred — the section's
  // primary job is "did money land on this invoice" which the row
  // listing answers.
  const invoicePayments = payments.data ?? [];

  return (
    <section className="px-8 py-8 flex flex-col gap-8">
      <Breadcrumbs
        items={[
          { label: 'Customers', to: '/crm/customers' },
          ...(customerId
            ? [
                {
                  label: fallbackLabel(customer.data?.display_name, customerId),
                  to: `/crm/customers/${customerId}`,
                },
              ]
            : []),
          { label: 'Invoices', to: '/invoicing/invoices' },
          { label: inv.invoice_number },
        ]}
      />
      {/* UX-Q7: display-only horizontal progress stepper. Replaces the
          "Status: <status>" line below the title. partially_paid is on
          the happy path between sent and paid per PR #99's B2 fix.
          F-Wave9-COWORK-SMOKE-07: pass visitedStates from audit_log so a
          skip transition (draft -> sent) does not paint PENDING as past. */}
      <StateStepper
        steps={[...STATE_STEPPER_PATHS.invoice.path]}
        current={inv.status}
        offPath={
          isOffPath('invoice', inv.status)
            ? {
                state: inv.status,
                label: STATE_STEPPER_PATHS.invoice.resolveLabel(inv.status),
              }
            : undefined
        }
        visitedStates={auditStates.data?.visited}
      />
      <PageHeader
        title={inv.invoice_number}
        meta={
          customerId || projectId || sourceQuoteId ? (
            <span className="flex flex-col gap-1">
              {customerId && (
                <span>
                  Customer:{' '}
                  <Link
                    to={`/crm/customers/${customerId}`}
                    className="text-ink hover:text-accent"
                  >
                    {fallbackLabel(customer.data?.display_name, customerId)}
                  </Link>
                </span>
              )}
              {projectId && (
                <span>
                  Project:{' '}
                  <Link
                    to={`/projects/${projectId}`}
                    className="text-ink hover:text-accent"
                  >
                    {fallbackLabel(project.data?.project.number, projectId)}
                  </Link>
                </span>
              )}
              {sourceQuoteId && (
                <span>
                  Source quote:{' '}
                  <Link
                    to={`/quotes/${sourceQuoteId}`}
                    className="text-ink hover:text-accent"
                  >
                    {fallbackLabel(sourceQuote.data?.quote.number, sourceQuoteId)}
                  </Link>
                </span>
              )}
            </span>
          ) : undefined
        }
      />

      <DetailLayout
        rail={
          <section>
            <h2 className="text-2xl font-display tracking-wide text-ink mb-3">
              HISTORY
            </h2>
            <AuditTimeline entityType="invoice" entityId={invoiceId} />
          </section>
        }
      >
        {/* Secondary cluster of header actions. Cancel and Download PDF
            live here at neutral weight; Send stays at primary weight
            because it is itself a forward transition from draft / pending
            (the state before Receive payment becomes available), so the
            "next step" CTA below never co-exists with Send. */}
        <div className="flex gap-2 flex-wrap items-start">
          {canSend && (() => {
            // F-Wave9-SEND-FEEDBACK-01: inline pending/success/error
            // feedback. The 2026-05-21 prod smoke walk caught the operator
            // clicking Send 7 times in a row because the original wiring
            // fired the mutation but rendered no feedback. Helper is
            // shared with QuoteDetailPage so both pages drift together.
            const feedback = computeSendButtonFeedback({
              isPending: sendMutation.isPending,
              isSuccess: sendMutation.isSuccess,
              error: sendMutation.error,
              sentAt: inv.sent_at,
            });
            return (
              <div className="flex flex-col gap-1" data-testid="invoice-send-feedback">
                <Button
                  onClick={() => sendMutation.mutate(invoiceId)}
                  disabled={feedback.disabled}
                >
                  {feedback.label}
                </Button>
                {feedback.helperText && (
                  <p className="font-sans text-xs text-ink-dim">
                    {feedback.helperText}
                  </p>
                )}
                {feedback.showSuccess && (
                  <p className="font-sans text-xs text-ink-dim">
                    {SEND_FEEDBACK_COPY.successLine}
                  </p>
                )}
                {feedback.errorMessage && (
                  <p className="font-sans text-sm text-accent">
                    {feedback.errorMessage}
                  </p>
                )}
              </div>
            );
          })()}
          {/* F-Wave9-AUDIT-V3-WAVE-E-01 (item 4): gate the Download PDF
              button to disabled while the invoice is in draft. Operators
              should send or approve the document first; the customer-
              facing artifact is only meaningful past draft. Tooltip on
              the wrapping span (disabled buttons don't fire title
              events on Chromium-via-aria-disabled patterns, so we
              keep the native disabled attr + a span carrier). */}
          {canRenderPdf && (() => {
            const pdfDisabled = isPdfDisabledForDraft(inv.status);
            return (
              <span title={pdfDisabled ? PDF_DRAFT_DISABLED_TOOLTIP : undefined}>
                <Button
                  variant="secondary"
                  onClick={onDownloadPdf}
                  disabled={pdfPending || pdfDisabled}
                >
                  {pdfPending ? 'Building.' : 'Download PDF'}
                </Button>
              </span>
            );
          })()}
          {canCancel && (
            <Button
              variant="ghost"
              onClick={async () => {
                // UX-Q8: cancelling a posted invoice changes the
                // customer-facing state (the append-only audit chain
                // stays intact server-side).
                if (!(await destructiveConfirm({
                  action: 'Cancel this invoice',
                  consequence: 'The invoice will move to cancelled and stop appearing in active receivable lists.',
                }))) return;
                cancelMutation.mutate(invoiceId);
              }}
              disabled={cancelMutation.isPending}
            >
              Cancel
            </Button>
          )}
        </div>

      {/* UX-Q4: forward-transition CTA promoted to primary top placement
          when status is sent / partially_paid / overdue. PaymentCreatePage
          already honors customer_id and invoice_id query params, so
          onReceivePayment navigates with both pre-filled. */}
      {canReceivePayment && (
        <NextStepCTA
          label="Receive payment"
          onClick={onReceivePayment}
        />
      )}

      <ReceivePaymentModal
        open={showReceivePayment}
        onClose={() => setShowReceivePayment(false)}
        invoiceId={invoiceId}
        customerId={customerId}
        balanceCents={inv.balance_cents}
        currencyCode={inv.currency_code}
      />


      {/* F-Wave9-SEND-FEEDBACK-01: sendMutation.error is now rendered
          inline beneath the Send button via computeSendButtonFeedback, so
          this combined error line covers only cancel + PDF download. */}
      {(cancelMutation.error || pdfError) && (
        <p className="font-sans text-sm text-accent">
          {(cancelMutation.error instanceof Error && cancelMutation.error.message) ||
            pdfError ||
            'Action failed.'}
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Stat label="Subtotal" value={formatCents(inv.subtotal_cents, inv.currency_code)} />
        <Stat label="Tax" value={formatCents(inv.tax_total_cents, inv.currency_code)} />
        <Stat label="Paid" value={formatCents(inv.paid_cents, inv.currency_code)} />
        <Stat label="Balance" value={formatCents(inv.balance_cents, inv.currency_code)} />
      </div>

      {/* F-Wave9-AUDIT-V3-WAVE-F-01: migrated to BillableLineItemsEditor.
          Slot props plug in the entity-specific cells + add-line fields;
          the shell (table chrome, Add-line button, picker, submit) lives
          in the shared component. Quote + shipment migrate next via
          F-Wave9-AUDIT-V3-WAVE-F-LINE-EDITOR-MIGRATIONS-01. */}
      <BillableLineItemsEditor
        canEdit={canEditLines}
        loading={lines.isLoading}
        lines={lines.data ?? []}
        columns={[
          { label: 'Description' },
          { label: 'Qty', align: 'right' },
          { label: 'Unit', align: 'right' },
          { label: 'Tax rate', align: 'right' },
          { label: 'Line total', align: 'right' },
          { label: '' },
        ]}
        renderLine={(l) => (
          <>
            <td className="py-2">{l.description}</td>
            <td className="py-2 text-right">{String(l.quantity)}</td>
            <td className="py-2 text-right">
              {formatCents(l.unit_price_cents, inv.currency_code)}
            </td>
            <td className="py-2 text-right">{String(l.tax_rate_snapshot)}</td>
            <td className="py-2 text-right">
              {formatCents(l.line_total_cents, inv.currency_code)}
            </td>
            <td className="py-2 text-right">
              {canEditLines && (
                <span className="flex justify-end gap-1">
                  <Button variant="ghost" onClick={() => beginEditLine(l)}>
                    Edit
                  </Button>
                  <Button variant="ghost" onClick={() => deleteLine.mutate(l.id)}>
                    Remove
                  </Button>
                </span>
              )}
            </td>
          </>
        )}
        onItemPicked={(itemId, item) => {
          setSelectedItemId(itemId);
          const next = applyItemSelectionToInvoiceLine(item);
          if (!next) return;
          setLineDesc(next.description);
          setLinePrice(next.unit_price_cents);
        }}
        onSubmit={onAddLine}
        addLinePending={addLine.isPending}
        addLineError={
          addLine.error instanceof Error
            ? addLine.error.message
            : addLine.error
              ? 'Add line failed.'
              : null
        }
        renderAddFields={() => (
          <>
            <TextInput
              label="Description"
              value={lineDesc}
              onChange={(e) => setLineDesc(e.target.value)}
              required
            />
            <TextInput
              label="Qty"
              value={lineQty}
              onChange={(e) => setLineQty(e.target.value)}
              inputMode="decimal"
            />
            <TextInput
              label="Unit price (cents)"
              value={linePrice}
              onChange={(e) => setLinePrice(e.target.value)}
              inputMode="numeric"
            />
          </>
        )}
      />

      {canEditLines && editLineId && (
        <form
          onSubmit={onSaveLine}
          className="flex flex-col gap-3 border border-accent p-4"
        >
          <h3 className="font-display tracking-wider text-ink">EDIT LINE</h3>
          <div className="flex gap-3 flex-wrap items-end">
            <TextInput
              label="Description"
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              required
            />
            <TextInput
              label="Qty"
              value={editQty}
              onChange={(e) => setEditQty(e.target.value)}
              inputMode="decimal"
            />
            <TextInput
              label="Unit price (cents)"
              value={editPrice}
              onChange={(e) => setEditPrice(e.target.value)}
              inputMode="numeric"
            />
            <TextInput
              label="Tax rate (e.g. 0.0825)"
              value={editTaxRate}
              onChange={(e) => setEditTaxRate(e.target.value)}
              inputMode="decimal"
            />
            <TextInput
              label="Discount (cents)"
              value={editDiscount}
              onChange={(e) => setEditDiscount(e.target.value)}
              inputMode="numeric"
            />
            <Button type="submit" disabled={updateLine.isPending}>
              {updateLine.isPending ? 'Saving.' : 'Save line'}
            </Button>
            <Button type="button" variant="ghost" onClick={cancelEditLine}>
              Cancel
            </Button>
          </div>
          {updateLine.error && (
            <p className="font-sans text-sm text-accent">
              {updateLine.error instanceof Error
                ? updateLine.error.message
                : 'Save line failed.'}
            </p>
          )}
        </form>
      )}

      <section>
        <h2 className="text-2xl font-display tracking-wide text-ink mb-3">PAYMENTS</h2>
        {invoicePayments.length === 0 ? (
          // BNEW-12: empty state reflects invoice-scoped semantics. The
          // customer-wide payments view stays on CustomerDetailPage.
          <p className="text-ink-dim text-sm">
            No payments applied to this invoice yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {invoicePayments.map((p) => (
              <li
                key={p.id}
                className="border border-line p-3 flex items-baseline justify-between"
              >
                <span className="font-mono text-sm text-ink">{p.payment_number}</span>
                <span className="text-ink-dim text-sm">
                  {formatCents(p.amount_cents, p.currency_code)} ·{' '}
                  unapplied {formatCents(p.unapplied_cents, p.currency_code)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      </DetailLayout>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg-2 border border-line p-4">
      <p className="text-xs uppercase text-ink-dim font-sans">{label}</p>
      <p className="text-2xl font-mono text-ink">{value}</p>
    </div>
  );
}
