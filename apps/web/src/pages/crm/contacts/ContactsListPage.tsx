// ContactsListPage. Migration to the shared UI kit (F-Wave10-UI-KIT-01, CRM
// mid): PageHeader + FilterBar (search) + DataTable + Pagination replace the
// hand-rolled header, raw search input, table, and pager. Behavior preserved:
// the ?customer_id= deep-link still filters the list and carries through to the
// create CTA, the free-text search still resets the page, and the onboarding
// ListEmptyState still renders only on a true empty list (no search, no
// customer filter).

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';

import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { FilterBar } from '@/components/ui/FilterBar';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { contactsKeys } from '@/lib/queryKeys/contacts';
import { listContacts } from '@/lib/services/contactsService';
import type { Contact } from '@/lib/types/crm';

const PAGE_SIZE = 50;

const COLUMNS: ReadonlyArray<DataColumn<Contact>> = [
  {
    key: 'name',
    header: 'Name',
    render: (c) => (
      <Link to={`/crm/contacts/${c.id}`} className="text-ink hover:text-accent">
        {[c.first_name, c.last_name].filter(Boolean).join(' ')}
      </Link>
    ),
  },
  {
    key: 'email',
    header: 'Email',
    cellClassName: 'text-ink-dim',
    render: (c) => c.email ?? '',
  },
  {
    key: 'title',
    header: 'Title',
    cellClassName: 'text-ink-dim',
    render: (c) => c.title ?? '',
  },
  {
    key: 'primary',
    header: 'Primary',
    cellClassName: 'text-ink-dim',
    render: (c) => (c.is_primary ? 'Yes' : ''),
  },
];

export function ContactsListPage() {
  const [search] = useSearchParams();
  const customerId = search.get('customer_id') ?? undefined;
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const filters = {
    ...(customerId ? { customer_id: customerId } : {}),
    ...(q ? { q } : {}),
  };
  const query = useQuery({
    queryKey: contactsKeys.list(filters as Record<string, unknown>),
    queryFn: () => listContacts(filters),
    staleTime: 30_000,
  });

  const rows = query.data ?? [];
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  const meta =
    !query.isLoading && !query.isError
      ? `${totalCount} ${totalCount === 1 ? 'contact' : 'contacts'}`
      : undefined;

  const showOnboardingEmpty =
    !query.isLoading && !query.isError && totalCount === 0 && !q && !customerId;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        eyebrow="CRM / Contacts"
        title="Contacts"
        meta={meta}
        actions={
          <Link
            to={
              customerId
                ? `/crm/contacts/new?customer_id=${customerId}`
                : '/crm/contacts/new'
            }
          >
            <Button variant="primary">New contact</Button>
          </Link>
        }
      />

      <FilterBar>
        <label className="flex items-center gap-2">
          <span className="font-sans text-xs uppercase tracking-wide text-ink-dim">
            Search
          </span>
          <input
            type="text"
            placeholder="Search by first name"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
            }}
            aria-label="Search contacts by first name"
            className="bg-bg-2 border border-line text-ink px-3 py-2 font-sans text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </label>
      </FilterBar>

      {query.isError ? (
        <p className="font-sans text-accent">Failed to load contacts.</p>
      ) : showOnboardingEmpty ? (
        <ListEmptyState
          entity="contact"
          explainer="Contacts are the people at your customer companies you talk to."
          addLabel="Add contact"
          addTo="/crm/contacts/new"
        />
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={pageRows}
            getRowKey={(c) => c.id}
            loading={query.isLoading}
            empty="No contacts match this filter."
          />
          {totalCount > PAGE_SIZE ? (
            <Pagination
              page={page}
              totalCount={totalCount}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
            />
          ) : null}
        </>
      )}
    </section>
  );
}
