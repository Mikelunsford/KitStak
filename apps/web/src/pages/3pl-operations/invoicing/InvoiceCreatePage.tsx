import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { FormGrid } from '@/components/ui/FormGrid';
import { CustomerPicker, ProjectPicker, QuotePicker } from '@/components/ui/pickers';
import { useCreateInvoice } from '@/lib/hooks/useInvoices';
import { useItemsList } from '@/lib/hooks/useItems';
import { useProjectLineItems, useProjectsList } from '@/lib/hooks/useProjects';
import { useShipmentLineItems } from '@/lib/hooks/useOps';
import { createInvoiceLineItem } from '@/lib/services/invoiceLineItemsService';
import { useCustomer } from '@/lib/hooks/useCustomer';
import { addDaysIso, todayIsoDate } from '@/lib/dates';

import { deriveInvoiceProjectId } from './deriveInvoiceProjectId';
import {
  projectLineToInvoiceLineCreate,
  shipmentLineToInvoiceLineCreate,
} from './sourceLinePrefill';

/**
 * InvoiceCreatePage. Captures the FK pivots that the handler already
 * accepts (G-INV-FORM-01): customer, project, quote. Line items are added
 * on the detail page after creation; the create handler does not accept
 * lines inline today. The source-quote linkage is captured as an optional
 * UUID input until the quote selection pattern (filtered by customer) is
 * added in a later wave.
 *
 * B1 (Wave B): when the caller deep-links with ?shipment_id= we read the
 * shipment's line items and POST a derived invoice line per row after the
 * header create succeeds (mirrors PR #104's two-stage create on the
 * shipment / receiving forms). When only ?project_id= is supplied we fall
 * back to project_line_items as the source. Operator can still edit lines
 * on the detail page after create.
 */
export function InvoiceCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const create = useCreateInvoice();

  const prefilledCustomerId = searchParams.get('customer_id');
  const prefilledProjectId = searchParams.get('project_id');
  const prefilledShipmentId = searchParams.get('shipment_id');

  // BNEW-4 (v2 smoke 2026-05-22): the invoicing-api handler now allocates
  // INV-YYYY-NNNNN via the numbering chassis when invoice_number is absent,
  // so the SPA no longer asks the operator to type it. Mirrors the quote /
  // receiving / shipment create pages landed at PR #105 (B8). Per-org prefix /
  // pad / reset policy is configurable from the numbering admin page.
  const [customerId, setCustomerId] = useState<string | null>(prefilledCustomerId);
  const [projectId, setProjectId] = useState<string | null>(prefilledProjectId);
  // B2 (Wave B): operator picks the source quote via the typed list now
  // rather than pasting a UUID. quoteId stays a nullable id so the rest
  // of the submit body code keeps its conditional spread shape.
  const [quoteId, setQuoteId] = useState<string | null>(null);

  // BNEW-9: when the caller deep-links with customer_id but no project_id
  // (e.g. the Shipment "Create invoice" CTA, since shipments don't carry
  // a project_id column yet — F-Wave9-UX-Q6-SHIPMENT-LIST-FILTER-01),
  // derive the most recent active project for that customer and use it
  // as the pre-fill. The operator can change it via the picker before
  // submit. We only derive when the operator hasn't picked anything
  // themselves yet (projectId is null) and the caller didn't pre-fill.
  const projectsList = useProjectsList(
    customerId ? { customer_id: customerId } : {},
  );
  useEffect(() => {
    if (projectId !== null) return;
    if (!customerId) return;
    if (projectsList.data === undefined) return;
    const derived = deriveInvoiceProjectId(projectsList.data, customerId);
    if (derived) setProjectId(derived);
    // We intentionally depend on `customerId` and the projects payload so
    // the derivation re-runs when the operator switches customers. Once
    // the operator picks a project (or the form already has one) we stop.
  }, [projectId, customerId, projectsList.data]);
  const [currency, setCurrency] = useState('USD');
  // B3 (Wave B): default issue_date to today so the operator does not
  // retype the common case. dueDate defaults to empty and is only
  // populated when the selected customer carries
  // default_payment_terms_days (set in the effect below). Operator can
  // edit either field after the auto-fill.
  const [issueDate, setIssueDate] = useState(() => todayIsoDate());
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');

  // B1: when the caller deep-links from a shipment we need to know the
  // shipment's lines (item_id + quantity + position) and the loaded
  // items list (for name + unit_price_cents) to build the per-line POST
  // payload. The shipment-id-less case falls back to project_line_items
  // which already carries its own description + price.
  const shipmentLines = useShipmentLineItems(prefilledShipmentId ?? undefined);
  const items = useItemsList();
  const projectLines = useProjectLineItems(
    !prefilledShipmentId && projectId ? projectId : undefined,
  );
  const [linesError, setLinesError] = useState<string | null>(null);
  const [submittingLines, setSubmittingLines] = useState(false);

  const derivedLineCount = useMemo(() => {
    if (prefilledShipmentId) return shipmentLines.data?.length ?? 0;
    if (projectId) return projectLines.data?.length ?? 0;
    return 0;
  }, [prefilledShipmentId, shipmentLines.data, projectId, projectLines.data]);
  // B3 (Wave B): once the operator picks a customer, default the due
  // date to issue_date + customer.default_payment_terms_days. We only
  // fill when dueDate is still empty so a manual edit is never
  // clobbered, and we re-run when either the customer or the issue
  // date changes upstream.
  const customer = useCustomer(customerId ?? undefined);
  useEffect(() => {
    if (dueDate !== '') return;
    const terms = customer.data?.default_payment_terms_days;
    if (terms === null || terms === undefined) return;
    const derived = addDaysIso(issueDate, terms);
    if (derived) setDueDate(derived);
  }, [dueDate, issueDate, customer.data?.default_payment_terms_days]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLinesError(null);
    try {
      const body: {
        currency_code: string;
        customer_id?: string;
        project_id?: string;
        quote_id?: string;
        issue_date?: string;
        due_date?: string;
        notes?: string;
      } = {
        currency_code: currency,
      };
      if (customerId) body.customer_id = customerId;
      if (projectId) body.project_id = projectId;
      if (quoteId) body.quote_id = quoteId;
      if (issueDate) body.issue_date = issueDate;
      if (dueDate) body.due_date = dueDate;
      if (notes) body.notes = notes;
      const inv = await create.mutateAsync(body);

      // B1: stage 2 — pre-fill line items from the source document.
      // Shipment wins when both are available because the shipment is
      // the more downstream reality (what we actually shipped should
      // be what we bill). project_line_items is the fallback when no
      // shipment was selected.
      const linesToCreate = (() => {
        if (prefilledShipmentId && shipmentLines.data) {
          return shipmentLines.data
            .map((l) =>
              shipmentLineToInvoiceLineCreate(l, items.data ?? undefined),
            )
            .filter((b): b is NonNullable<typeof b> => b !== null);
        }
        if (!prefilledShipmentId && projectLines.data) {
          return projectLines.data.map(projectLineToInvoiceLineCreate);
        }
        return [];
      })();

      if (linesToCreate.length > 0) {
        setSubmittingLines(true);
        try {
          for (const lineBody of linesToCreate) {
            await createInvoiceLineItem(inv.id, lineBody);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'unknown error';
          setLinesError(
            `Invoice created but a line failed: ${msg}. Add the rest on the detail page.`,
          );
          setSubmittingLines(false);
          navigate(`/invoicing/invoices/${inv.id}`);
          return;
        }
        setSubmittingLines(false);
      }

      navigate(`/invoicing/invoices/${inv.id}`);
    } catch {
      // surfaced via mutation state; banner below renders the message
    }
  }

  const pending = create.isPending || submittingLines;

  return (
    <section className="px-8 py-8 max-w-4xl flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">NEW INVOICE</h1>
      {/* F-Wave9-AUDIT-V3-WAVE-F-01: two-column form grid. The customer
          / project / quote / currency / dates fan out side by side on
          md and up; notes and the submit row span the full width via
          FormGrid.Full. Mobile collapses to one column automatically. */}
      <form onSubmit={onSubmit}>
        <FormGrid columns={2}>
          <FormGrid.Full>
            <CustomerPicker
              value={customerId}
              onChange={setCustomerId}
              label="Customer"
            />
          </FormGrid.Full>
          <ProjectPicker
            value={projectId}
            onChange={setProjectId}
            label="Project (optional)"
            filter={customerId ? { customer_id: customerId } : undefined}
          />
          <QuotePicker
            value={quoteId}
            onChange={setQuoteId}
            label="Source quote (optional)"
            filter={customerId ? { customer_id: customerId } : undefined}
          />
          <Field label="Currency">
            <input
              type="text"
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              required
              maxLength={3}
              className="w-full bg-bg-2 border border-line px-3 py-2 text-ink font-sans"
            />
          </Field>
          <Field label="Issue date">
            <input
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              className="w-full bg-bg-2 border border-line px-3 py-2 text-ink font-sans"
            />
          </Field>
          <Field label="Due date">
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full bg-bg-2 border border-line px-3 py-2 text-ink font-sans"
            />
          </Field>
          <FormGrid.Full>
            <Field label="Notes">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full bg-bg-2 border border-line px-3 py-2 text-ink font-sans"
              />
            </Field>
          </FormGrid.Full>

          {derivedLineCount > 0 && (
            <FormGrid.Full>
              <p className="text-ink-dim font-sans text-sm">
                {derivedLineCount} line item{derivedLineCount === 1 ? '' : 's'} will
                be pre-filled from the source{' '}
                {prefilledShipmentId ? 'shipment' : 'project'}.
              </p>
            </FormGrid.Full>
          )}

          {linesError && (
            <FormGrid.Full>
              <p className="text-accent font-sans text-sm">{linesError}</p>
            </FormGrid.Full>
          )}

          {create.error && (
            <FormGrid.Full>
              <p className="text-accent font-sans text-sm">
                {(create.error as Error).message}
              </p>
            </FormGrid.Full>
          )}

          <FormGrid.Full>
            <div className="flex gap-2">
              <Button type="submit" disabled={pending}>
                {pending ? 'Saving.' : 'Create'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => navigate('/invoicing/invoices')}
              >
                Cancel
              </Button>
            </div>
          </FormGrid.Full>
        </FormGrid>
      </form>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase text-ink-dim font-sans">{label}</span>
      {children}
    </label>
  );
}
