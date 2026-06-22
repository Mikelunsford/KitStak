// ContactDetailPage. Migration to the shared UI kit (F-Wave10-UI-KIT-01, CRM
// mid): PageHeader replaces the hand-rolled header. Contacts have no FSM and no
// history, so this stays a single-column relationship hub (no DetailLayout),
// mirroring CustomerDetailPage. The breadcrumb chain (Customers -> customer ->
// contact) with its fallbackLabel and the EntityLabel customer link are
// preserved verbatim.

import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import { fallbackLabel } from '@/components/shell/breadcrumbFallback';
import { EntityLabel } from '@/components/data/EntityLabel';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { useCustomer } from '@/lib/hooks/useCustomer';
import { contactsKeys } from '@/lib/queryKeys/contacts';
import { getContact } from '@/lib/services/contactsService';

export function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const query = useQuery({
    queryKey: id
      ? contactsKeys.detail(id)
      : ['crm', 'contacts', 'detail', 'noop'],
    queryFn: () => getContact(id as string),
    enabled: Boolean(id),
    staleTime: 30_000,
  });

  // UX-Q10: resolve customer display_name for the breadcrumb chain. Fires
  // only when the contact loads (customer_id ?? undefined disables until
  // present); TanStack Query dedupes if any other place on the page is
  // already fetching the same customer.
  const customer = useCustomer(query.data?.customer_id ?? undefined);

  if (query.isLoading) {
    return <p className="px-8 py-10 font-sans text-ink-dim">Loading.</p>;
  }
  if (!query.data) {
    return <p className="px-8 py-10 font-sans text-accent">Contact not found.</p>;
  }
  const c = query.data;
  const contactFullName = [c.first_name, c.last_name].filter(Boolean).join(' ');
  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6 px-8 py-10">
      <Breadcrumbs
        items={[
          { label: 'Customers', to: '/crm/customers' },
          {
            label: fallbackLabel(customer.data?.display_name, c.customer_id),
            to: `/crm/customers/${c.customer_id}`,
          },
          { label: contactFullName },
        ]}
      />
      <PageHeader
        title={contactFullName}
        actions={
          <Link to={`/crm/contacts/${c.id}/edit`}>
            <Button variant="secondary">Edit</Button>
          </Link>
        }
      />
      <dl className="grid grid-cols-2 gap-4 font-sans text-sm">
        <dt className="text-ink-dim">Customer</dt>
        <dd>
          <EntityLabel kind="customer" id={c.customer_id} />
        </dd>
        <dt className="text-ink-dim">Email</dt>
        <dd>{c.email ?? ''}</dd>
        <dt className="text-ink-dim">Phone</dt>
        <dd>{c.phone ?? ''}</dd>
        <dt className="text-ink-dim">Title</dt>
        <dd>{c.title ?? ''}</dd>
        <dt className="text-ink-dim">Primary</dt>
        <dd>{c.is_primary ? 'Yes' : 'No'}</dd>
        <dt className="text-ink-dim">Active</dt>
        <dd>{c.is_active ? 'Yes' : 'No'}</dd>
      </dl>
    </section>
  );
}
