// CreditNotesListPage. Workstream C of the 2026-06-17 UI scan adds the server
// list toolbar (search, sortable headers, status facet, keyset pager, saved
// views) behind feature.list_toolbar. The flag-off path is the original
// client-slice view, extracted verbatim into CreditNotesListLegacy; the flag-on
// path is CreditNotesListToolbar. The parent renders one or the other.
//
// Behavior preserved: the number link still targets the canonical
// /invoicing/credit-notes detail path while the create CTA targets
// /invoicing/credit-notes/new, and the onboarding ListEmptyState still
// renders on a true empty list in the legacy path.

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { LINK_CLASS } from '@/components/data/entityLabelStyles';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { ListToolbar } from '@/components/ui/ListToolbar';
import { SavedViewsBar } from '@/components/ui/SavedViewsBar';
import { Select } from '@/components/ui/Select';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { CursorPager } from '@/components/ui/CursorPager';
import { StatusBadge, humaniseStatus } from '@/components/ui/StatusBadge';
import { useCreditNotes } from '@/lib/hooks/useCreditNotes';
import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { useServerList } from '@/lib/hooks/useServerList';
import { listCreditNotesPage } from '@/lib/services/creditNotesService';
import { creditNoteKeys } from '@/lib/queryKeys/creditNotes';
import { FEATURE_FLAGS } from '@/lib/constants';
import { formatCents } from '@/lib/money';
import type { CreditNote } from '@/lib/types/finance';

const PAGE_SIZE = 50;

const CREDIT_NOTE_STATUSES = [
  'draft',
  'issued',
  'applied',
  'voided',
] as const;

const COLUMNS: ReadonlyArray<DataColumn<CreditNote>> = [
  {
    key: 'number',
    header: 'Number',
    sortKey: 'credit_note_number',
    cellClassName: 'tabular-nums',
    render: (cn) => (
      <Link to={`/invoicing/credit-notes/${cn.id}`} className={LINK_CLASS}>
        {cn.credit_note_number}
      </Link>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    sortKey: 'status',
    render: (cn) => <StatusBadge status={cn.status} />,
  },
  {
    key: 'amount',
    header: 'Amount',
    align: 'right',
    sortKey: 'amount_cents',
    cellClassName: 'tabular-nums',
    render: (cn) =>
      formatCents(cn.amount_cents as number | string, cn.currency_code),
  },
  {
    key: 'applied',
    header: 'Applied',
    align: 'right',
    cellClassName: 'tabular-nums',
    render: (cn) =>
      formatCents(cn.applied_cents as number | string, cn.currency_code),
  },
];

export function CreditNotesListPage() {
  const flags = useOrgFlags();
  return flags.data[FEATURE_FLAGS.UI_LIST_TOOLBAR] ? (
    <CreditNotesListToolbar />
  ) : (
    <CreditNotesListLegacy />
  );
}

function CreditNotesListToolbar() {
  const server = useServerList<CreditNote>({
    enabled: true,
    queryKeyBase: creditNoteKeys.all,
    fetchPage: listCreditNotesPage,
    defaultSort: { by: 'created_at', dir: 'desc' },
    facets: [{ key: 'status', label: 'Status', format: humaniseStatus }],
  });

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        title="Credit notes"
        actions={
          <Link to="/invoicing/credit-notes/new">
            <Button variant="primary">New credit note</Button>
          </Link>
        }
      />

      <ListToolbar
        searchValue={server.searchInput}
        onSearchChange={server.setSearchInput}
        searchPlaceholder="Search credit note number"
        chips={server.chips}
        onClearAll={server.clearAll}
      >
        <label className="flex items-center gap-2">
          <span className="font-sans text-xs uppercase tracking-wide text-ink-dim">
            Status
          </span>
          <Select
            value={server.facetValues.status ?? ''}
            onChange={(e) => server.setFacet('status', e.target.value)}
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            {CREDIT_NOTE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humaniseStatus(s)}
              </option>
            ))}
          </Select>
        </label>
      </ListToolbar>

      <SavedViewsBar
        entityType="credit_note"
        currentConfig={server.viewConfig}
        onApply={server.applyView}
      />

      {server.isError ? (
        <p className="font-sans text-accent">Failed to load credit notes.</p>
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={server.rows}
            getRowKey={(cn) => cn.id}
            loading={server.isLoading}
            empty="No credit notes match these filters."
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

/**
 * CreditNotesListLegacy. Lists credit notes for the active org (client slice).
 */
function CreditNotesListLegacy() {
  const [page, setPage] = useState(0);
  const { data, isLoading, error } = useCreditNotes();

  const rows = data ?? [];
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  const meta =
    !isLoading && !error
      ? `${totalCount} ${totalCount === 1 ? 'credit note' : 'credit notes'}`
      : undefined;

  const showOnboardingEmpty = !isLoading && !error && totalCount === 0;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        title="Credit notes"
        meta={meta}
        actions={
          <Link to="/invoicing/credit-notes/new">
            <Button variant="primary">New credit note</Button>
          </Link>
        }
      />

      {error ? (
        <p className="font-sans text-accent">Failed to load credit notes.</p>
      ) : showOnboardingEmpty ? (
        <ListEmptyState
          entity="credit note"
          explainer="Credit notes reverse part or all of an invoice."
          addLabel="Add credit note"
          addTo="/invoicing/credit-notes/new"
        />
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={pageRows}
            getRowKey={(cn) => cn.id}
            loading={isLoading}
            empty="No credit notes yet."
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
