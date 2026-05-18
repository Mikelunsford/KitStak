import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { useCreateInvoice } from '@/lib/hooks/useInvoices';

/**
 * InvoiceCreatePage. useState + Zod safeParse pattern. The number is
 * caller-supplied for now; a Wave 3 follow-up replaces this with
 * next_doc_number RPC integration.
 */
export function InvoiceCreatePage() {
  const navigate = useNavigate();
  const create = useCreateInvoice();

  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [issueDate, setIssueDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      const body: {
        invoice_number: string;
        currency_code: string;
        issue_date?: string;
        due_date?: string;
        notes?: string;
      } = {
        invoice_number: invoiceNumber,
        currency_code: currency,
      };
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
        <Field label="Invoice number">
          <input
            type="text"
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
            required
            className="w-full bg-bg-2 border border-line px-3 py-2 text-ink font-sans"
          />
        </Field>
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
          <button
            type="submit"
            disabled={create.isPending}
            className="px-4 py-2 bg-accent text-on-primary font-display tracking-wider text-sm disabled:opacity-50"
          >
            CREATE
          </button>
          <button
            type="button"
            onClick={() => navigate('/invoicing/invoices')}
            className="px-4 py-2 border border-line text-ink font-display tracking-wider text-sm"
          >
            CANCEL
          </button>
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
