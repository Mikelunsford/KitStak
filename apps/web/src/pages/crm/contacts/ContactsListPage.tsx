// ContactsListPage. Workstream C of the 2026-06-17 UI scan adds the server list
// toolbar (search on name + email, sortable headers, keyset pager, saved views)
// behind feature.list_toolbar. The flag-off path is the original client-state
// view (the F-Wave10-UI-KIT-01 migration: PageHeader + FilterBar + DataTable +
// Pagination, with the ?customer_id= deep-link applied server-side), extracted
// verbatim into ContactsListLegacy; the flag-on path is ContactsListToolbar. The
// parent renders one or the other.

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';

import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { FilterBar } from '@/components/ui/FilterBar';
import { ListToolbar } from '@/components/ui/ListToolbar';
import { SavedViewsBar } from '@/components/ui/SavedViewsBar';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { CursorPager } from '@/components/ui/CursorPager';
import { LINK_CLASS } from '@/components/data/entityLabelStyles';
import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { useServerList } from '@/lib/hooks/useServerList';
import { contactsKeys } from '@/lib/queryKeys/contacts';
import { listContacts, listContactsPage } from '@/lib/services/contactsService';
import { FEATURE_FLAGS } from '@/lib/constants';
import type { Contact } from '@/lib/types/crm';

const PAGE_SIZE = 50;

const COLUMNS: ReadonlyArray<DataColumn<Contact>> = [
  {
    key: 'name',
    header: 'Name',
    sortKey: 'first_name',
    render: (c) => (
      <Link to={`/crm/contacts/${c.id}`} className={LINK_CLASS}>
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
  const flags = useOrgFlags();
  return flags.data[FEATURE_FLAGS.UI_LIST_TOOLBAR] ? (
    <ContactsListToolbar />
  ) : (
    <ContactsListLegacy />
  );
}

function ContactsListToolbar() {
  const [search] = useSearchParams();
  const customerId = search.get('customer_id') ?? undefined;
  // customer_id is a deep-link scope, not a user-picked dropdown. Declaring it
  // as a facet lets useServerList read it from the URL, scope the server query
  // by it, and surface a removable chip without a Select control.
  const server = useServerList<Contact>({
    enabled: true,
    queryKeyBase: contactsKeys.all,
    fetchPage: listContactsPage,
    defaultSort: { by: 'created_at', dir: 'desc' },
    facets: [{ key: 'customer_id', label: 'Customer' }],
  });

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        title="Contacts"
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

      <ListToolbar
        searchValue={server.searchInput}
        onSearchChange={server.setSearchInput}
        searchPlaceholder="Search name or email"
        chips={server.chips}
        onClearAll={server.clearAll}
      />

      <SavedViewsBar
        entityType="contact"
        currentConfig={server.viewConfig}
        onApply={server.applyView}
      />

      {server.isError ? (
        <p className="font-sans text-accent">Failed to load contacts.</p>
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={server.rows}
            getRowKey={(c) => c.id}
            loading={server.isLoading}
            empty="No contacts match these filters."
            sortBy={server.sortBy}
            sortDir={server.sortDir}
            onSort={server.onSort}
          />
          <CursorPager
            canPrev={server.canPrev}
            canNext={server.canNext}
            onPrev={server.onPrev}
            onNext={server.onNext}
            label={`${server.rows.length} shown`}
          />
        </>
      )}
    </section>
  );
}

function ContactsListLegacy() {
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
