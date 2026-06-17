import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import {
  type LucideIcon,
  Activity,
  CreditCard,
  FileText,
  Folder,
  Receipt,
  Users,
} from 'lucide-react';

import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import { DetailSectionEmptyCoaching } from '@/components/shell/DetailSectionEmptyCoaching';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Tabs, type TabSpec } from '@/components/ui/Tabs';
import { formatCents } from '@/lib/money';
import { useCustomer } from '@/lib/hooks/useCustomer';
import { useInviteCustomerToPortal } from '@/lib/hooks/useCustomers';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
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

  const tabs: TabSpec[] = [
    {
      key: 'overview',
      label: 'Overview',
      panel: (
        <div className="flex flex-col gap-8">
          <dl className="grid grid-cols-2 gap-4 font-sans text-sm">
            <dt className="text-ink-dim">Kind</dt>
            <dd>{c.kind}</dd>
            <dt className="text-ink-dim">Status</dt>
            <dd>
              <StatusBadge status={c.status} />
            </dd>
            <dt className="text-ink-dim">Email</dt>
            <dd>{c.primary_email ?? ''}</dd>
            <dt className="text-ink-dim">Phone</dt>
            <dd>{c.primary_phone ?? ''}</dd>
            <dt className="text-ink-dim">Tax id</dt>
            <dd>{c.tax_id ?? ''}</dd>
            <dt className="text-ink-dim">Default currency</dt>
            <dd>{c.default_currency_code ?? ''}</dd>
          </dl>

          <InviteToPortalSection
            customerId={c.id}
            customerEmail={c.primary_email}
          />
        </div>
      ),
    },
    {
      key: 'quotes',
      label: 'Quotes',
      panel: (
        <RelatedSection
          title="QUOTES"
          entity="quote"
          ctaLabel="New quote"
          ctaHref={`/quotes/new?customer_id=${c.id}`}
          isLoading={quotesQuery.isLoading}
          emptyExplainer="Quotes are priced proposals you send to win the work. Approved quotes convert to projects."
          emptyIcon={FileText}
          count={relatedQuotes.length}
        >
          {relatedQuotes.map((q) => (
            <li key={q.id} className="border border-line bg-bg-2 px-3 py-2 text-sm font-sans">
              <Link to={`/quotes/${q.id}`} className="underline">
                {q.number}
                {q.title ? ` . ${q.title}` : ''}
              </Link>
              <span className="ml-2 inline-flex"><StatusBadge status={q.state} /></span>
            </li>
          ))}
        </RelatedSection>
      ),
    },
    {
      key: 'projects',
      label: 'Projects',
      panel: (
        <RelatedSection
          title="PROJECTS"
          entity="project"
          ctaLabel="New project"
          ctaHref={`/projects/new?customer_id=${c.id}`}
          isLoading={projectsQuery.isLoading}
          emptyExplainer="Projects are the units of work you deliver to this customer. Each one tracks materials, phases, and shipments."
          emptyIcon={Folder}
          count={relatedProjects.length}
        >
          {relatedProjects.map((p) => (
            <li key={p.id} className="border border-line bg-bg-2 px-3 py-2 text-sm font-sans">
              <Link to={`/projects/${p.id}`} className="underline">
                {p.number}
                {p.name ? ` . ${p.name}` : ''}
              </Link>
              <span className="ml-2 inline-flex"><StatusBadge status={p.state} /></span>
            </li>
          ))}
        </RelatedSection>
      ),
    },
    {
      key: 'invoices',
      label: 'Invoices',
      panel: (
        <RelatedSection
          title="INVOICES"
          entity="invoice"
          ctaLabel="New invoice"
          ctaHref={`/invoicing/invoices/new?customer_id=${c.id}`}
          isLoading={invoicesQuery.isLoading}
          emptyExplainer="Invoices bill this customer for delivered work. Send one to start the receivable clock."
          emptyIcon={Receipt}
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
              <span className="ml-2 inline-flex"><StatusBadge status={inv.status} /></span>
            </li>
          ))}
        </RelatedSection>
      ),
    },
    {
      key: 'payments',
      label: 'Payments',
      panel: (
        <RelatedSection
          title="PAYMENTS"
          entity="payment"
          ctaLabel="Receive payment"
          ctaHref={`/invoicing/payments/new?customer_id=${c.id}`}
          isLoading={paymentsQuery.isLoading}
          emptyExplainer="Payments record money received against this customer's invoices. Log them to close out receivables."
          emptyIcon={CreditCard}
          count={payments.length}
        >
          {payments.map((p) => (
            <li
              key={p.id}
              className="border border-line bg-bg-2 px-3 py-2 text-sm font-sans"
            >
              <span>{p.payment_number}</span>
              <span className="text-ink-dim ml-2 text-xs font-mono">
                {formatCents(p.amount_cents, p.currency_code ?? 'USD')}
              </span>
            </li>
          ))}
        </RelatedSection>
      ),
    },
    {
      key: 'contacts',
      label: 'Contacts',
      panel: (
        <RelatedSection
          title="CONTACTS"
          entity="contact"
          ctaLabel="New contact"
          ctaHref={`/crm/contacts/new?customer_id=${c.id}&return_to=${encodeURIComponent(`/crm/customers/${c.id}`)}`}
          isLoading={contactsQuery.isLoading}
          emptyExplainer="Contacts are the people at this customer you work with. Add buyers, AP clerks, and warehouse leads to keep the line of communication clear."
          emptyIcon={Users}
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
      ),
    },
    {
      key: 'activities',
      label: 'Activities',
      panel: (
        <RelatedSection
          title="ACTIVITIES"
          entity="activity"
          ctaLabel="New activity"
          ctaHref={`/crm/activities/new?entity_type=customer&entity_id=${c.id}`}
          isLoading={activitiesQuery.isLoading}
          emptyExplainer="Activities log calls, emails, and meetings with this customer so the next handoff has the history."
          emptyIcon={Activity}
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
      ),
    },
  ];

  return (
    <section className="px-8 py-10 max-w-4xl mx-auto flex flex-col gap-8">
      <Breadcrumbs
        items={[
          { label: 'Customers', to: '/crm/customers' },
          { label: c.display_name },
        ]}
      />
      <PageHeader
        eyebrow="CRM / Customers"
        title={c.display_name}
        actions={
          <Link to={`/crm/customers/${c.id}/edit`}>
            <Button variant="secondary">Edit</Button>
          </Link>
        }
      />
      <Tabs aria-label="Customer detail" tabs={tabs} />
    </section>
  );
}

interface RelatedSectionProps {
  title: string;
  /** Singular entity noun for the coaching surface, e.g. "quote". */
  entity: string;
  ctaLabel: string;
  ctaHref: string;
  isLoading: boolean;
  /**
   * Sentence-cased explainer rendered by DetailSectionEmptyCoaching when
   * the related list is empty. Should answer "what is this section for?".
   * Authored per-section in the CustomerDetailPage caller so each list
   * carries the right operator-readable context.
   */
  emptyExplainer: string;
  /** Optional lucide icon for the coaching surface. */
  emptyIcon?: LucideIcon;
  count: number;
  children: ReactNode;
}

function RelatedSection({
  title,
  entity,
  ctaLabel,
  ctaHref,
  isLoading,
  emptyExplainer,
  emptyIcon,
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
        <DetailSectionEmptyCoaching
          entity={entity}
          explainer={emptyExplainer}
          ctaLabel={ctaLabel}
          ctaTo={ctaHref}
          icon={emptyIcon}
        />
      )}
    </section>
  );
}

/**
 * Path B2: invite a customer to the self-service portal. Cap-gated on
 * crm.customers.invite_to_portal (granted to org_owner, org_admin, sales,
 * accounting). Hidden entirely for callers without the cap.
 *
 * Recipient resolution: customer.primary_email is the default. Operator can
 * override via the optional input (e.g. invite a specific contact at a
 * company even when the customer record carries a generic billing address).
 *
 * Inline mutation feedback is deliberate: clicking the button shows
 * "Sending invite." -> "Invite sent. {email}" or "Invite failed: {msg}".
 * Closes the F-Wave9-SEND-FEEDBACK-01 class of UI gap that bit the quote
 * Send button during Path B1 prod smoke.
 */
function InviteToPortalSection({
  customerId,
  customerEmail,
}: {
  customerId: string;
  customerEmail: string | null;
}) {
  const caps = useCapabilities();
  const invite = useInviteCustomerToPortal(customerId);
  const [emailOverride, setEmailOverride] = useState('');

  if (!caps.can('crm.customers.invite_to_portal')) {
    return null;
  }

  const resolvedEmail = emailOverride.trim() || customerEmail || null;
  const canSubmit = Boolean(resolvedEmail) && !invite.isPending;

  return (
    <section className="border border-line bg-bg-2 p-4 flex flex-col gap-3">
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-display tracking-wide text-ink">
          CUSTOMER PORTAL ACCESS
        </h2>
      </header>
      <p className="text-sm text-ink-dim font-sans">
        Invite this customer to the self-service portal. They will receive a
        magic-link email and can view their own invoices, quotes, and
        projects. The link arrives from the Kitstak sender domain configured
        in your auth settings.
      </p>
      <TextInput
        label={`Recipient email (leave blank to use ${customerEmail ?? 'customer.primary_email'})`}
        value={emailOverride}
        onChange={(e) => setEmailOverride(e.target.value)}
        type="email"
        placeholder={customerEmail ?? 'customer has no primary_email on file'}
      />
      <div className="flex gap-2 items-center">
        <Button
          onClick={() =>
            invite.mutate(
              emailOverride.trim()
                ? { email_override: emailOverride.trim() }
                : {},
            )
          }
          disabled={!canSubmit}
        >
          {invite.isPending ? 'Sending invite.' : 'Invite to portal'}
        </Button>
        {!resolvedEmail ? (
          <p className="text-sm text-ink-dim font-sans">
            Add a primary email to the customer or enter one above.
          </p>
        ) : null}
      </div>
      {invite.isSuccess ? (
        <p
          role="status"
          className="font-sans text-sm text-success border-l-2 border-success pl-3 py-1 bg-success/5"
        >
          Invite sent to {invite.data.email}. The customer will receive a
          magic-link email shortly.
        </p>
      ) : null}
      {invite.isError ? (
        <p
          role="alert"
          className="font-sans text-sm text-accent border-l-2 border-accent pl-3 py-1 bg-accent/5"
        >
          Invite failed: {invite.error instanceof Error ? invite.error.message : 'unknown error'}
        </p>
      ) : null}
    </section>
  );
}
