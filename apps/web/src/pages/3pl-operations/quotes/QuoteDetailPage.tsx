import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import { NextStepCTA } from '@/components/shell/NextStepCTA';
import { StateStepper } from '@/components/shell/StateStepper';
import {
  STATE_STEPPER_PATHS,
  isOffPath,
} from '@/lib/workflow/stateStepperPaths';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { Select } from '@/components/ui/Select';
import { PageHeader } from '@/components/ui/PageHeader';
import { DetailHeader } from '@/components/ui/DetailHeader';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { DetailLayout } from '@/components/ui/DetailLayout';
import { DollarInput } from '@/components/forms/DollarInput';
import { PercentInput } from '@/components/forms/PercentInput';
import { QuantityInput } from '@/components/forms/QuantityInput';
import { ItemPicker } from '@/components/ui/pickers';
import {
  useQuote, useSubmitQuote, useApproveQuote, useReviseQuote,
  useCancelQuote, useSendQuote, useConvertQuoteToProject, useDuplicateQuote,
  useAddLineItem, useUpdateLineItem, useRemoveLineItem, useUpdateQuote,
} from '@/lib/hooks/useQuotes';
import { useCustomer } from '@/lib/hooks/useCustomer';
import { useMe } from '@/lib/hooks/useMe';
import { useJobTypes } from '@/lib/hooks/useJobTypes';
import { hasCap } from '@/lib/capabilities';
import { renderPdf } from '@/lib/services/pdfService';
import { canTransition, QUOTE_FSM } from '@/lib/workflow/sales';
import { shouldShowQuoteNextStepCTA } from '@/lib/workflow/nextStepCTA';
import {
  isPdfDisabledForDraft,
  PDF_DRAFT_DISABLED_TOOLTIP,
} from '@/lib/workflow/pdfGating';
import { formatCents } from '@/lib/money';
import { formatQuantity } from '@/lib/formatQuantity';
import { displayTitle } from '@/lib/displayTitle';
import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { FEATURE_FLAGS } from '@/lib/constants';
import { destructiveConfirm } from '@/lib/destructiveConfirm';
import {
  computeSendButtonFeedback,
  SEND_FEEDBACK_COPY,
} from '@/lib/workflow/sendButtonFeedback';
import type { QuoteState, QuoteLineItem } from '@/lib/types/sales';

/**
 * QuoteDetailPage. Header now resolves customer display_name with a link to
 * the customer detail page. Line-add form uses ItemPicker; selecting an item
 * pre-fills sku, unit_price_cents, and item_id, with tax/discount inputs
 * exposed (the handler already accepts them per G-QUOTE-LINE-01).
 *
 * PR-6 / B7: the DB enum keeps the historical `submitted` value
 * (constitutional: forward-only migrations) but the operator-facing
 * verb is "send for approval" in the pre-approval phase and "send to
 * customer" in the post-approval phase. The state pill renders "Sent
 * for approval" while the underlying value stays `submitted`.
 */

// PR-6 / B7: vocabulary helper extracted to formatQuoteStateLabel.ts so
// the vitest unit test can exercise the pure formatter without
// transitively loading the supabase singleton at module load.
import { formatQuoteStateLabel } from './formatQuoteStateLabel';
// PR-C / BNEW-3: item-pick prefill helper extracted to applyItemSelection.ts
// for the same reason — pure function, unit-testable, fixes the async-stale
// race in the previous synchronous handler.
import { applyItemSelection } from './applyItemSelection';
// P0-2: customer-chip label resolver. Gates the loading window so the header
// never flashes the raw customer id before useCustomer resolves.
import { resolveCustomerLabel } from './resolveCustomerLabel';
// Wave 12 / A3: apply-template control extracted to its own component.
import { ApplyTemplatePanel } from './ApplyTemplatePanel';
import { QuoteTiersPanel } from './QuoteTiersPanel';

export { formatQuoteStateLabel };

export function QuoteDetailPage() {
  const { id } = useParams();
  const { data, isLoading, error } = useQuote(id);
  const addLine = useAddLineItem(id ?? '');
  const updateLine = useUpdateLineItem(id ?? '');
  const removeLine = useRemoveLineItem(id ?? '');
  const submit = useSubmitQuote();
  const approve = useApproveQuote();
  const revise = useReviseQuote();
  const cancel = useCancelQuote();
  const send = useSendQuote();
  const convert = useConvertQuoteToProject();
  const duplicate = useDuplicateQuote();
  const updateQuote = useUpdateQuote(id ?? '');
  const jobTypes = useJobTypes();
  const orgFlags = useOrgFlags();

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [lineName, setLineName] = useState('');
  const [lineSku, setLineSku] = useState('');
  // PR A2: integer storage units via primitives. qty_e3 defaults to 1000
  // (1 unit), price/discount default to 0.
  const [lineQty, setLineQty] = useState<number | null>(1000);
  const [linePrice, setLinePrice] = useState<number | null>(0);
  const [lineDiscountBps, setLineDiscountBps] = useState<number | null>(0);
  const [lineTaxId, setLineTaxId] = useState('');
  const [lineIsTaxable, setLineIsTaxable] = useState(true);
  // ADR 0005 Phase 1a.2: one_time (default) or monthly (recurring) on the add-line form.
  const [lineBillingInterval, setLineBillingInterval] =
    useState<'one_time' | 'monthly'>('one_time');
  // ADR 0004: the tier a new line is added to (when tiered) and the accepted tier
  // chosen on convert. Empty string falls back to the first tier.
  const [lineTierId, setLineTierId] = useState('');
  const [convertTierId, setConvertTierId] = useState('');
  const [pdfPending, setPdfPending] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  // Inline draft-line edit. editLineId tracks which line the operator is
  // editing; the edit fields mirror the ADD LINE inputs (same primitives) and
  // are seeded from the line's current values when Edit is clicked. The handler
  // only edits an existing line in place; kind is frozen server-side so it is
  // not exposed here.
  const [editLineId, setEditLineId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editSku, setEditSku] = useState('');
  const [editQty, setEditQty] = useState<number | null>(1000);
  const [editPrice, setEditPrice] = useState<number | null>(0);
  const [editDiscountBps, setEditDiscountBps] = useState<number | null>(0);
  const [editTaxId, setEditTaxId] = useState('');
  const [editIsTaxable, setEditIsTaxable] = useState(true);
  const [editBillingInterval, setEditBillingInterval] =
    useState<'one_time' | 'monthly'>('one_time');

  const customerId = data?.quote.customer_id ?? null;
  const customer = useCustomer(customerId ?? undefined);
  const me = useMe({ enabled: true });
  const canRenderPdf = me.data?.active_role
    ? hasCap(me.data.active_role, 'pdf.document.render')
    : false;

  // PR-F: pre-fill happens synchronously in the picker's onChange handler
  // below. The previous useItem(id) + useEffect plumbing introduced a
  // visible flash (id was set one render before name/sku/price landed),
  // and the dropdown already has the matched record in scope at click
  // time. The applyItemSelection helper still owns the field-population
  // shape so the existing unit test continues to lock the contract.

  if (isLoading) return <p className="p-8 text-ink-dim">Loading.</p>;
  if (error || !data) return <p className="p-8 text-accent">Quote not found.</p>;

  const { quote, lineItems, tiers } = data;
  const state = quote.state as QuoteState;
  // ADR 0004: a quote is tiered once it has at least one tier. The header total
  // then lives at the tier grain (0 on the quote), so the flat lines table and
  // header total are replaced by QuoteTiersPanel while editable.
  const sortedTiers = [...tiers].sort((a, b) => a.sort_order - b.sort_order);
  const isTiered = sortedTiers.length > 0;
  const firstTierId = sortedTiers[0]?.id ?? null;

  // Workstream B: name-first detail header behind feature.detail_header.
  // No status pill here; the StateStepper above owns the current state.
  const detailHeaderV2 = orgFlags.data[FEATURE_FLAGS.UI_DETAIL_HEADER];
  const quoteTitle = displayTitle('quote', quote, {
    customerName: customer.data?.display_name ?? null,
  });

  // Wave 12 / A3: 3PL job type display plus the next free line position used
  // when a Job Builder template appends its lines to this quote.
  const nextLinePosition = lineItems.length
    ? Math.max(...lineItems.map((l) => l.position)) + 1
    : 0;
  const jobTypeName =
    (jobTypes.data ?? []).find((j) => j.id === quote.job_type_id)?.name ?? null;
  const jobTypeEditable = !['cancelled', 'project_pending'].includes(state);

  // UX-Q7 reopened (Pattern D): the rail's next step advances the quote through
  // its happy path using the same handlers as the action buttons below. The
  // quote FSM allows every consecutive happy-path edge (draft -> submitted ->
  // approved -> project_pending), so the next rail step is always a valid move;
  // the server enforces the cap, exactly as the buttons do.
  const advanceQuote = (toState: string) => {
    if (!id) return;
    if (toState === 'submitted') submit.mutate(id);
    else if (toState === 'approved') approve.mutate(id);
    else if (toState === 'project_pending') {
      convert.mutate({ id, tierId: isTiered ? (convertTierId || firstTierId) : null });
    }
  };
  const advancePending =
    submit.isPending || approve.isPending || convert.isPending;

  // F-Wave8-PDF-QUOTE-DOWNLOAD-01. Build the quote render payload from the
  // loaded quote and its line items, call the pdf-worker, and trigger a
  // download via a hidden anchor. Mirrors InvoiceDetailPage's onDownloadPdf.
  const onDownloadPdf = async () => {
    setPdfError(null);
    setPdfPending(true);
    try {
      // QuoteLineItem stores quantity_e3 (thousandths). Convert to a decimal
      // string before handing to the worker so the rendered PDF reads as a
      // normal quantity rather than a thousandths integer.
      const result = await renderPdf('quote', {
        customer_display_name: customer.data?.display_name ?? '',
        quote_number: quote.number,
        issue_date: quote.submitted_at ?? quote.sent_at ?? '',
        lines: lineItems.map((l) => ({
          description: l.name,
          quantity: (Number(l.quantity_e3) / 1000).toFixed(3),
          unit_price_cents: String(l.unit_price_cents),
          line_total_cents: String(l.line_total_cents),
        })),
        subtotal_cents: String(quote.subtotal_cents),
        tax_cents: String(quote.tax_cents),
        total_cents: String(quote.total_cents),
        currency: quote.currency_code,
      });
      if ('not_available' in result) {
        setPdfError(result.message);
        return;
      }
      const a = document.createElement('a');
      a.href = result.url;
      a.download = `quote-${quote.number}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : 'Download failed.');
    } finally {
      setPdfPending(false);
    }
  };

  const onAddLine = (e: FormEvent) => {
    e.preventDefault();
    if (!id) return;
    // F-Wave7-MUTATION-ERRORS-SWEEP-01: mutate(input, { onSuccess }) so a
    // 4xx surfaces in the inline error renderer under the form instead of
    // silently leaving the operator with a stuck form.
    addLine.mutate(
      {
        name: lineName,
        sku: lineSku || null,
        item_id: selectedItemId,
        kind: 'item',
        quantity_e3: lineQty ?? 0,
        unit_price_cents: linePrice ?? 0,
        discount_bps: lineDiscountBps ?? 0,
        tax_id: lineTaxId || null,
        is_taxable: lineIsTaxable,
        // ADR 0005 Phase 1a.2: the add-line billing-interval selector.
        billing_interval: lineBillingInterval,
        // ADR 0004: a tiered quote adds the line to the chosen tier (default the
        // first) so it is never an orphan; a non-tiered quote adds it untiered.
        tier_id: isTiered ? (lineTierId || firstTierId) : null,
      },
      {
        onSuccess: () => {
          setSelectedItemId(null);
          setLineName('');
          setLineSku('');
          setLineQty(1000);
          setLinePrice(0);
          setLineDiscountBps(0);
          setLineTaxId('');
          setLineIsTaxable(true);
          setLineBillingInterval('one_time');
          setLineTierId('');
        },
      },
    );
  };

  const beginEditLine = (l: QuoteLineItem) => {
    setEditLineId(l.id);
    setEditName(l.name);
    setEditSku(l.sku ?? '');
    setEditQty(Number(l.quantity_e3));
    setEditPrice(Number(l.unit_price_cents));
    setEditDiscountBps(l.discount_bps);
    setEditTaxId(l.tax_id ?? '');
    setEditIsTaxable(l.is_taxable);
    setEditBillingInterval(l.billing_interval);
  };

  const cancelEditLine = () => {
    setEditLineId(null);
    updateLine.reset();
  };

  const onSaveLine = (e: FormEvent) => {
    e.preventDefault();
    if (!id || !editLineId) return;
    // Server re-snapshots tax and recomputes every line_*_cents from these
    // trusted inputs; the SPA never sends totals. tax_id is sent as a value
    // (string or null) so the handler re-resolves the rate even when cleared.
    updateLine.mutate(
      {
        lineId: editLineId,
        payload: {
          name: editName,
          sku: editSku || null,
          quantity_e3: editQty ?? 0,
          unit_price_cents: editPrice ?? 0,
          discount_bps: editDiscountBps ?? 0,
          tax_id: editTaxId || null,
          is_taxable: editIsTaxable,
          billing_interval: editBillingInterval,
        },
      },
      {
        onSuccess: () => {
          setEditLineId(null);
        },
      },
    );
  };

  const lineColumns: DataColumn<QuoteLineItem>[] = [
    { key: 'name', header: 'Name', render: (l) => l.name },
    {
      key: 'qty',
      header: 'Qty',
      align: 'right',
      cellClassName: 'tabular-nums',
      render: (l) => formatQuantity(Number(l.quantity_e3) / 1000),
    },
    {
      key: 'unit',
      header: 'Unit price',
      align: 'right',
      cellClassName: 'tabular-nums',
      render: (l) => formatCents(l.unit_price_cents, quote.currency_code),
    },
    {
      key: 'tax',
      header: 'Tax %',
      align: 'right',
      cellClassName: 'tabular-nums',
      render: (l) => (l.tax_rate_snapshot / 100).toFixed(2),
    },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      cellClassName: 'tabular-nums',
      render: (l) => formatCents(l.line_total_cents, quote.currency_code),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (l) =>
        ['draft', 'revise_requested'].includes(state) ? (
          <span className="flex justify-end gap-1">
            <Button variant="ghost" onClick={() => beginEditLine(l)}>
              Edit
            </Button>
            <Button variant="ghost" onClick={() => removeLine.mutate(l.id)}>
              Remove
            </Button>
          </span>
        ) : null,
    },
  ];

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <Breadcrumbs
        items={[
          { label: 'Customers', to: '/crm/customers' },
          ...(customerId
            ? [
                {
                  label: resolveCustomerLabel(customer.data?.display_name, customerId, customer.isLoading),
                  to: `/crm/customers/${customerId}`,
                },
              ]
            : []),
          { label: 'Quotes', to: '/quotes' },
          { label: quote.number },
        ]}
      />
      {/* UX-Q7 reopened (Pattern D): the rail's immediate next step is an
          interactive control that advances the quote (advanceQuote maps it to
          the same submit / approve / convert handlers as the buttons below).
          Past, current, and further-future steps stay display-only. Placed below
          the breadcrumbs and above the title so the stepper sets the workflow
          context the operator carries into everything below it. */}
      <StateStepper
        steps={[...STATE_STEPPER_PATHS.quote.path]}
        current={state}
        offPath={
          isOffPath('quote', state)
            ? { state, label: formatQuoteStateLabel(state) }
            : undefined
        }
        onAdvance={advanceQuote}
        advancePending={advancePending}
      />
      {detailHeaderV2 ? (
        <DetailHeader
          title={quoteTitle.title}
          number={quoteTitle.number}
          customer={
            customerId
              ? {
                  label: resolveCustomerLabel(customer.data?.display_name, customerId, customer.isLoading),
                  to: `/crm/customers/${customerId}`,
                }
              : null
          }
          money={{
            label: 'Total',
            value: formatCents(quote.total_cents, quote.currency_code),
          }}
        />
      ) : (
        <PageHeader
          title={quote.number}
          meta={
            quote.title || customerId ? (
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {quote.title ? <span>{quote.title}</span> : null}
                {customerId ? (
                  <span>
                    Customer:{' '}
                    <Link
                      to={`/crm/customers/${customerId}`}
                      className="text-ink hover:text-accent"
                    >
                      {resolveCustomerLabel(customer.data?.display_name, customerId, customer.isLoading)}
                    </Link>
                  </span>
                ) : null}
              </span>
            ) : undefined
          }
        />
      )}

      <DetailLayout
        rail={
          <section>
            <h2 className="text-2xl font-display tracking-wide text-ink mb-3">
              HISTORY
            </h2>
            <AuditTimeline entityType="quote" entityId={id ?? null} />
          </section>
        }
      >
      {/* UX-Q4: forward-transition CTA promoted to primary top placement.
          Predicate lives in `@/lib/workflow/nextStepCTA` so the regression
          test can lock the trigger state. */}
      {shouldShowQuoteNextStepCTA(state) && id && (
        <div className="flex flex-col gap-2">
          {isTiered ? (
            <label className="flex items-center gap-2">
              <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
                Accept tier
              </span>
              <select
                value={convertTierId || (firstTierId ?? '')}
                onChange={(e) => setConvertTierId(e.target.value)}
                className="bg-bg-2 border border-line text-ink px-3 py-2 text-sm font-sans focus:outline-none focus:border-accent"
              >
                {sortedTiers.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </label>
          ) : null}
          <NextStepCTA
            label="Convert to project"
            onClick={() =>
              convert.mutate({ id, tierId: isTiered ? (convertTierId || firstTierId) : null })
            }
            pending={convert.isPending}
            error={
              convert.isError
                ? convert.error instanceof Error
                  ? convert.error.message
                  : 'Convert failed.'
                : null
            }
          />
        </div>
      )}

      {/* Secondary cluster. Cancel / revise / sideways transitions stay
          visible (operator who NEEDS to cancel shouldn't have to dig), but
          render at secondary weight so they don't compete with the primary
          forward CTA above. Submit and Approve also live here — they are
          forward transitions but their next-step CTA targets the LATER
          state (approved -> project_pending), so wiring them at top-CTA
          weight would create two primaries on the same page. */}
      <div className="flex flex-wrap gap-2">
        {canTransition(QUOTE_FSM, state, 'submitted') && id && (
          <Button variant="secondary" onClick={() => submit.mutate(id)}>Send for approval</Button>
        )}
        {canTransition(QUOTE_FSM, state, 'approved') && id && (
          <Button variant="secondary" onClick={() => approve.mutate(id)}>Approve</Button>
        )}
        {canTransition(QUOTE_FSM, state, 'revise_requested') && id && (
          <Button variant="secondary" onClick={() => revise.mutate(id)}>Request revise</Button>
        )}
        {canTransition(QUOTE_FSM, state, 'cancelled') && id && (
          <Button
            variant="ghost"
            onClick={async () => {
              // UX-Q8: cancelling reverses an active sales flow.
              if (!(await destructiveConfirm({
                action: 'Cancel this quote',
                consequence: 'The quote will move to cancelled and stop appearing in active sales lists.',
              }))) return;
              cancel.mutate(id);
            }}
          >Cancel</Button>
        )}
        {/* P1-3: Duplicate is available from any state. The highest-volume
            account quotes in quantity-break tiers; cloning is the per-tier
            shortcut (the new draft lands ready to edit qty and unit price). */}
        {id && (
          <Button
            variant="secondary"
            onClick={() => duplicate.mutate(id)}
            disabled={duplicate.isPending}
          >
            {duplicate.isPending ? 'Duplicating.' : 'Duplicate'}
          </Button>
        )}
        {state === 'approved' && id && (() => {
          // F-Wave9-SEND-FEEDBACK-01: inline pending/success/error feedback
          // on the Send button. The 2026-05-21 prod smoke walk caught the
          // operator clicking Send 7 times in a row because the button
          // fired the mutation but rendered no feedback at all. The label
          // copy ("Sent to customer" -> "Send again" once already sent),
          // the disabled flag, and the helper microcopy all flow out of
          // computeSendButtonFeedback so QuoteDetailPage and
          // InvoiceDetailPage drift together if at all.
          const feedback = computeSendButtonFeedback({
            isPending: send.isPending,
            isSuccess: send.isSuccess,
            error: send.error,
            sentAt: quote.sent_at,
          });
          // Quote-side verb is "Send to customer" on first send; only
          // override the idle label and keep helper-resolved copy for
          // every other state (pending, success, resend, error).
          const baseLabel = !send.isPending && !send.isSuccess && !send.error && !quote.sent_at
            ? 'Send to customer'
            : feedback.label;
          return (
            <div className="flex flex-col gap-1" data-testid="quote-send-feedback">
              <Button
                variant="secondary"
                onClick={() => send.mutate(id)}
                disabled={feedback.disabled}
              >
                {baseLabel}
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
            button to disabled while the quote is draft or
            revise_requested. Both are pre-customer states the operator
            is still working in; rendering a PDF off them would leak
            a half-baked document. Tooltip on the wrapping span (the
            Button's native disabled attr swallows pointer events, so
            title text rides on the carrier). */}
        {canRenderPdf && (() => {
          const pdfDisabled = isPdfDisabledForDraft(state);
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
      </div>
      {pdfError && (
        <p className="text-accent font-sans text-sm">
          {pdfError}
        </p>
      )}
      {duplicate.isError && (
        <p className="text-accent font-sans text-sm">
          {duplicate.error instanceof Error
            ? duplicate.error.message
            : 'Duplicate failed.'}
        </p>
      )}

      {/* Wave 12 / A3: the 3PL job type this quote is scoped to. Editable while
          the quote is live (convert_quote_to_project carries it onto the
          project so a won quote becomes a project of the right type); read-only
          once terminal. Also set automatically when a template is applied. */}
      {jobTypeEditable ? (
        <label className="flex max-w-xs flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Job type
          </span>
          <Select
            value={quote.job_type_id ?? ''}
            onChange={(e) =>
              updateQuote.mutate({ job_type_id: e.target.value || null })
            }
            disabled={jobTypes.isLoading || updateQuote.isPending}
          >
            <option value="">{jobTypes.isLoading ? 'Loading.' : 'None'}</option>
            {(jobTypes.data ?? []).map((j) => (
              <option key={j.id} value={j.id}>
                {j.name}
              </option>
            ))}
          </Select>
          {updateQuote.error && (
            <span className="font-sans text-sm text-accent">
              {updateQuote.error instanceof Error
                ? updateQuote.error.message
                : 'Update job type failed.'}
            </span>
          )}
        </label>
      ) : jobTypeName ? (
        <p className="font-sans text-sm text-ink-dim">Job type: {jobTypeName}</p>
      ) : null}

      <div className="flex flex-col gap-2">
        {/* ADR 0004: a tiered, editable quote shows its lines grouped per tier in
            QuoteTiersPanel below; the flat table stays for non-tiered quotes and
            for read-only (non-editable) quotes of any shape. */}
        {!isTiered || !['draft', 'revise_requested'].includes(state) ? (
          <DataTable
            columns={lineColumns}
            rows={lineItems}
            getRowKey={(l) => l.id}
            empty="No line items yet."
          />
        ) : null}
        {!isTiered ? (
          <div className="flex items-center justify-end gap-6 px-4 text-sm">
            <span className="text-ink-dim">Total</span>
            <span className="tabular-nums text-ink">
              {formatCents(quote.total_cents, quote.currency_code)}
            </span>
          </div>
        ) : null}
      </div>

      {['draft', 'revise_requested'].includes(state) && id ? (
        <QuoteTiersPanel
          quoteId={id}
          tiers={tiers}
          lineItems={lineItems}
          currencyCode={quote.currency_code}
          onEditLine={beginEditLine}
        />
      ) : null}

      {['draft', 'revise_requested'].includes(state) && editLineId && (
        <form
          onSubmit={onSaveLine}
          className="flex flex-col gap-3 border border-accent p-4"
        >
          <h3 className="font-display tracking-wider text-ink">EDIT LINE</h3>
          <div className="flex gap-3 flex-wrap items-end">
            <TextInput
              label="Name"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              required
            />
            <TextInput
              label="SKU"
              value={editSku}
              onChange={(e) => setEditSku(e.target.value)}
            />
            <QuantityInput
              label="Quantity"
              value={editQty}
              onChange={setEditQty}
            />
            <DollarInput
              label="Unit price"
              value={editPrice}
              onChange={setEditPrice}
            />
            <PercentInput
              label="Discount"
              value={editDiscountBps}
              onChange={setEditDiscountBps}
            />
            <TextInput
              label="Tax id (optional)"
              value={editTaxId}
              onChange={(e) => setEditTaxId(e.target.value)}
            />
            <label className="flex items-center gap-2 mt-6">
              <input
                type="checkbox"
                checked={editIsTaxable}
                onChange={(e) => setEditIsTaxable(e.target.checked)}
              />
              <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
                Taxable
              </span>
            </label>
            <label className="flex flex-col gap-2">
              <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
                Billing
              </span>
              <select
                value={editBillingInterval}
                onChange={(e) =>
                  setEditBillingInterval(e.target.value as 'one_time' | 'monthly')
                }
                className="bg-bg-2 border border-line text-ink px-4 py-3 font-sans focus:outline-none focus:border-accent disabled:opacity-50"
              >
                <option value="one_time">One time</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
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

      {['draft', 'revise_requested'].includes(state) && id && (
        <ApplyTemplatePanel quoteId={id} basePosition={nextLinePosition} />
      )}

      {['draft', 'revise_requested'].includes(state) && (
        <form onSubmit={onAddLine} className="flex flex-col gap-3 border border-line p-4">
          <h3 className="font-display tracking-wider text-ink">ADD LINE</h3>
          <ItemPicker
            value={selectedItemId}
            onChange={(itemId, item) => {
              setSelectedItemId(itemId);
              const next = applyItemSelection(item);
              if (!next) return;
              setLineName(next.name);
              setLineSku(next.sku);
              // PR A2: linePrice is now integer cents; applyItemSelection
              // emits a numeric string for backwards compatibility, so we
              // parse it here.
              setLinePrice(Number(next.unit_price_cents));
            }}
            label="Item (optional, pre-fills name and price)"
            filter={{ active: true }}
          />
          <div className="flex gap-3 flex-wrap items-end">
            <TextInput
              label="Name"
              value={lineName}
              onChange={(e) => setLineName(e.target.value)}
              required
            />
            <TextInput
              label="SKU"
              value={lineSku}
              onChange={(e) => setLineSku(e.target.value)}
            />
            <QuantityInput
              label="Quantity"
              value={lineQty}
              onChange={setLineQty}
            />
            <DollarInput
              label="Unit price"
              value={linePrice}
              onChange={setLinePrice}
            />
            <PercentInput
              label="Discount"
              value={lineDiscountBps}
              onChange={setLineDiscountBps}
            />
            <TextInput
              label="Tax id (optional)"
              value={lineTaxId}
              onChange={(e) => setLineTaxId(e.target.value)}
            />
            <label className="flex items-center gap-2 mt-6">
              <input
                type="checkbox"
                checked={lineIsTaxable}
                onChange={(e) => setLineIsTaxable(e.target.checked)}
              />
              <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
                Taxable
              </span>
            </label>
            <label className="flex flex-col gap-2">
              <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
                Billing
              </span>
              <select
                value={lineBillingInterval}
                onChange={(e) =>
                  setLineBillingInterval(e.target.value as 'one_time' | 'monthly')
                }
                className="bg-bg-2 border border-line text-ink px-4 py-3 font-sans focus:outline-none focus:border-accent disabled:opacity-50"
              >
                <option value="one_time">One time</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
            {isTiered ? (
              <label className="flex flex-col gap-2">
                <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
                  Tier
                </span>
                <select
                  value={lineTierId || (firstTierId ?? '')}
                  onChange={(e) => setLineTierId(e.target.value)}
                  className="bg-bg-2 border border-line text-ink px-4 py-3 font-sans focus:outline-none focus:border-accent disabled:opacity-50"
                >
                  {sortedTiers.map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
              </label>
            ) : null}
            <Button type="submit" disabled={addLine.isPending}>
              {addLine.isPending ? 'Adding.' : 'Add line'}
            </Button>
          </div>
          {addLine.error && (
            <p className="font-sans text-sm text-accent">
              {addLine.error instanceof Error
                ? addLine.error.message
                : 'Add line failed.'}
            </p>
          )}
        </form>
      )}

      </DetailLayout>
    </section>
  );
}
