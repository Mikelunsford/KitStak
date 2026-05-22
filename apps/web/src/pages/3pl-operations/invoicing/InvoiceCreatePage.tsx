import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { CustomerPicker, ProjectPicker, QuotePicker } from '@/components/ui/pickers';
import { useCreateInvoice } from '@/lib/hooks/useInvoices';
import { useProjectsList } from '@/lib/hooks/useProjects';

import { deriveInvoiceProjectId } from './deriveInvoiceProjectId';

/**
 * InvoiceCreatePage. Captures the FK pivots that the handler already
 * accepts (G-INV-FORM-01): customer, project, quote. Line items are added
 * on the detail page after creation; the create handler does not accept
 * lines inline today. The source-quote linkage is captured as an optional
 * UUID input until the quote selection pattern (filtered by customer) is
 * added in a later wave.
 */
export function InvoiceCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const create = useCreateInvoice();

  const prefilledCustomerId = searchParams.get('customer_id');
  const prefilledProjectId = searchParams.get('project_id');

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
  const [issueDate, setIssueDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
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
      navigate(`/invoicing/invoices/${inv.id}`);
    } catch {
      // surfaced via mutation state; banner below renders the message
    }
  }

  return (
    <section className="px-8 py-8 max-w-2xl flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">NEW INVOICE</h1>
      <form className="flex flex-col gap-4" onSubmit={onSubmit}>
        <CustomerPicker
          value={customerId}
          onChange={setCustomerId}
          label="Customer"
        />
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
        <Field label="Notes">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full bg-bg-2 border border-line px-3 py-2 text-ink font-sans"
          />
        </Field>

        {create.error && (
          <p className="text-accent font-sans text-sm">
            {(create.error as Error).message}
          </p>
        )}

        <div className="flex gap-2">
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Saving.' : 'Create'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate('/invoicing/invoices')}
          >
            Cancel
          </Button>
        </div>
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
