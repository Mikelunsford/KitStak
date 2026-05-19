import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

import { useCustomer } from '@/lib/hooks/useCustomer';
import { useQuotesList } from '@/lib/hooks/useQuotes';
import { useProjectsList } from '@/lib/hooks/useProjects';
import { useInvoices } from '@/lib/hooks/useInvoices';
import { usePayments } from '@/lib/hooks/usePayments';
import { contactsKeys } from '@/lib/queryKeys/contacts';
import { listContacts } from '@/lib/services/contactsService';
import { listActivities } from '@/lib/services/activitiesService';

/**
 * CustomerDetailPage. Closes G-CUST-DETAIL-01 by adding six related-entity
 * sections so the customer record is the chain hub it was always meant to be.
 * Each section lists records that reference this customer plus a "New X" CTA
 * that lands on the matching create form with customer_id pre-filled via the
 * query string.
 *
 * F-Wave7-LISTFILTER-01: the quotes and projects list services now accept a
 * customer_id filter that lifts the previous client-side .filter(...) into
 * the SQL where-clause. Bandwidth bound to single-customer rows, paginated
 * lists no longer miss children beyond the first page, and RLS Pattern A
 * still 200 + []s a cross-tenant customer_id at the org gate.
 */
export function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const query = useCustomer(id);

  const quotesQuery = useQuotesList(id ? { customer_id: id } : {});
  const projectsQuery = useProjectsList(id ? { customer_id: id } : {});
  const invoicesQuery = useInvoices(id ? { customer_id: id } : {});
  const paymentsQuery = usePayments(id ? { customer_id: id } : {});

  const contactsQuery = useQuery({
    queryKey: id
      ? contactsKeys.list({ customer_id: id })
      : ['crm', 'contacts', 'list', 'noop'],
    queryFn: () => listContacts({ customer_id: id as string }),
    enabled: Boolean(id),
    staleTime: 30_000,
  });

  const activitiesQuery = useQuery({
    queryKey: id
      ? (['crm', 'activities', 'list', { entity_type: 'customer', entity_id: id }] as const)
      : (['crm', 'activities', 'list', 'noop'] as const),
    queryFn: () =>
      listActivities({ entity_type: 'customer', entity_id: id as string }),
    enabled: Boolean(id),
    staleTime: 30_000,
  });

  if (query.isLoading) {
    return <p className="px-8 py-10 font-sans text-ink-dim">Loading.</p>;
  }
  if (query.isError || !query.data) {
    return (
      <p className="px-8 py-10 font-sans text-accent">
        Customer not found.
      </p>
    );
  }
  const c = query.data;

  // F-Wave7-LISTFILTER-01: server-side customer_id filter; no client-side
  // .filter(...) over the full org list.
  const relatedQuotes = quotesQuery.data ?? [];
  const relatedProjects = projectsQuery.data ?? [];
  const invoices = invoicesQuery.data ?? [];
  const payments = paymentsQuery.data ?? [];
  const contacts = contactsQuery.data ?? [];
  const activities = activitiesQuery.data ?? [];

  return (
    <section className="px-8 py-10 max-w-4xl mx-auto flex flex-col gap-8">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-4xl font-display tracking-wide text-ink">
          {c.display_name.toUpperCase()}
        </h1>
        <Link
          to={`/crm/customers/${c.id}/edit`}
          className="px-4 py-2 bg-bg-2 border border-line font-display tracking-wider"
        >
          EDIT
        </Link>
      </header>
      <dl className="grid grid-cols-2 gap-4 font-sans text-sm">
        <dt className="text-ink-dim">Kind</dt>
        <dd>{c.kind}</dd>
        <dt className="text-ink-dim">Status</dt>
        <dd>{c.status}</dd>
        <dt className="text-ink-dim">Email</dt>
        <dd>{c.primary_email ?? ''}</dd>
        <dt className="text-ink-dim">Phone</dt>
        <dd>{c.primary_phone ?? ''}</dd>
        <dt className="text-ink-dim">Tax id</dt>
        <dd>{c.tax_id ?? ''}</dd>
        <dt className="text-ink-dim">Default currency</dt>
        <dd>{c.default_currency_code ?? ''}</dd>
      </dl>

      <RelatedSection
        title="QUOTES"
        ctaLabel="New quote"
        ctaHref={`/3pl-operations/quotes/new?customer_id=${c.id}`}
        isLoading={quotesQuery.isLoading}
        emptyMessage="No quotes for this customer."
        count={relatedQuotes.length}
      >
        {relatedQuotes.map((q) => (
          <li key={q.id} className="border border-line bg-bg-2 px-3 py-2 text-sm font-sans">
            <Link to={`/3pl-operations/quotes/${q.id}`} className="underline">
              {q.number}
              {q.title ? ` . ${q.title}` : ''}
            </Link>
            <span className="text-ink-dim ml-2 text-xs font-mono">{q.state}</span>
          </li>
        ))}
      </RelatedSection>

      <RelatedSection
        title="PROJECTS"
        ctaLabel="New project"
        ctaHref={`/3pl-operations/projects/new?customer_id=${c.id}`}
        isLoading={projectsQuery.isLoading}
        emptyMessage="No projects for this customer."
        count={relatedProjects.length}
      >
        {relatedProjects.map((p) => (
          <li key={p.id} className="border border-line bg-bg-2 px-3 py-2 text-sm font-sans">
            <Link to={`/3pl-operations/projects/${p.id}`} className="underline">
              {p.number}
              {p.name ? ` . ${p.name}` : ''}
            </Link>
            <span className="text-ink-dim ml-2 text-xs font-mono">{p.state}</span>
          </li>
        ))}
      </RelatedSection>

      <RelatedSection
        title="INVOICES"
        ctaLabel="New invoice"
        ctaHref={`/invoicing/invoices/new?customer_id=${c.id}`}
        isLoading={invoicesQuery.isLoading}
        emptyMessage="No invoices for this customer."
        count={invoices.length}
      >
        {invoices.map((inv) => (
          <li
            key={inv.id}
            className="border border-line bg-bg-2 px-3 py-2 text-sm font-sans"
          >
            <Link to={`/invoicing/invoices/${inv.id}`} className="underline">
              {inv.invoice_number}
            </Link>
            <span className="text-ink-dim ml-2 text-xs font-mono">{inv.status}</span>
          </li>
        ))}
      </RelatedSection>

      <RelatedSection
        title="PAYMENTS"
        ctaLabel="Receive payment"
        ctaHref={`/3pl-operations/payments/new?customer_id=${c.id}`}
        isLoading={paymentsQuery.isLoading}
        emptyMessage="No payments received from this customer."
        count={payments.length}
      >
        {payments.map((p) => (
          <li
            key={p.id}
            className="border border-line bg-bg-2 px-3 py-2 text-sm font-sans"
          >
            <span>{p.payment_number}</span>
            <span className="text-ink-dim ml-2 text-xs font-mono">
              {p.amount_cents} {p.currency_code ?? ''}
            </span>
          </li>
        ))}
      </RelatedSection>

      <RelatedSection
        title="CONTACTS"
        ctaLabel="New contact"
        ctaHref={`/crm/contacts/new?customer_id=${c.id}`}
        isLoading={contactsQuery.isLoading}
        emptyMessage="No contacts for this customer."
        count={contacts.length}
      >
        {contacts.map((ct) => (
          <li
            key={ct.id}
            className="border border-line bg-bg-2 px-3 py-2 text-sm font-sans"
          >
            <Link to={`/crm/contacts/${ct.id}`} className="underline">
              {[ct.first_name, ct.last_name].filter(Boolean).join(' ')}
            </Link>
            {ct.title ? (
              <span className="text-ink-dim ml-2 text-xs">{ct.title}</span>
            ) : null}
          </li>
        ))}
      </RelatedSection>

      <RelatedSection
        title="ACTIVITIES"
        ctaLabel="New activity"
        ctaHref={`/crm/activities/new?entity_type=customer&entity_id=${c.id}`}
        isLoading={activitiesQuery.isLoading}
        emptyMessage="No activities logged for this customer."
        count={activities.length}
      >
        {activities.map((a) => (
          <li
            key={a.id}
            className="border border-line bg-bg-2 px-3 py-2 text-sm font-sans"
          >
            <span>{a.subject}</span>
            <span className="text-ink-dim ml-2 text-xs font-mono">
              {a.kind} . {a.status}
            </span>
          </li>
        ))}
      </RelatedSection>
    </section>
  );
}

interface RelatedSectionProps {
  title: string;
  ctaLabel: string;
  ctaHref: string;
  isLoading: boolean;
  emptyMessage: string;
  count: number;
  children: ReactNode;
}

function RelatedSection({
  title,
  ctaLabel,
  ctaHref,
  isLoading,
  emptyMessage,
  count,
  children,
}: RelatedSectionProps) {
  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-display tracking-wide text-ink">{title}</h2>
        <Link
          to={ctaHref}
          className="px-3 py-1 bg-bg-2 border border-line font-display tracking-wider text-xs"
        >
          {ctaLabel.toUpperCase()}
        </Link>
      </header>
      {isLoading ? (
        <p className="font-sans text-sm text-ink-dim">Loading.</p>
      ) : count > 0 ? (
        <ul className="flex flex-col gap-1">{children}</ul>
      ) : (
        <p className="font-sans text-sm text-ink-dim">{emptyMessage}</p>
      )}
    </section>
  );
}
