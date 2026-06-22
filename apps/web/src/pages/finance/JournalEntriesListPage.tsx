// JournalEntriesListPage. Workstream C of the 2026-06-17 UI scan adds the server
// list toolbar (search on entry number, sortable headers, status facet, keyset
// pager, saved views) behind feature.list_toolbar. The flag-off path is the
// original client-state view (the F-Wave10-UI-KIT-01 migration: PageHeader +
// DataTable + StatusBadge + Pagination, with the period format, uppercase
// source, number link, and the server-enforced finance.journal_entries.enabled
// flag error surfaced inline), extracted verbatim into JournalEntriesListLegacy;
// the flag-on path is JournalEntriesListToolbar. The parent renders one or the
// other.

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { ListToolbar } from '@/components/ui/ListToolbar';
import { SavedViewsBar } from '@/components/ui/SavedViewsBar';
import { Select } from '@/components/ui/Select';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { CursorPager } from '@/components/ui/CursorPager';
import { StatusBadge, humaniseStatus } from '@/components/ui/StatusBadge';
import { LINK_CLASS } from '@/components/data/entityLabelStyles';
import { useJournalEntries } from '@/lib/hooks/useJournalEntries';
import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { useServerList } from '@/lib/hooks/useServerList';
import { listJournalEntriesPage } from '@/lib/services/journalEntriesService';
import { journalEntryKeys } from '@/lib/queryKeys/journalEntries';
import { FEATURE_FLAGS } from '@/lib/constants';
import type { JournalEntry } from '@/lib/types/finance';

const PAGE_SIZE = 50;

// Journal entry statuses the list accepts via ?status=. Ordered for the filter
// dropdown; an arbitrary string never reaches the filter state.
const JOURNAL_ENTRY_STATUSES = ['draft', 'posted', 'reversed'] as const;

const COLUMNS: ReadonlyArray<DataColumn<JournalEntry>> = [
  {
    key: 'number',
    header: 'Number',
    cellClassName: 'tabular-nums',
    render: (je) => (
      <Link
        to={`/finance/journal-entries/${je.id}`}
        className={LINK_CLASS}
      >
        {je.entry_number}
      </Link>
    ),
  },
  {
    key: 'date',
    header: 'Date',
    sortKey: 'entry_date',
    cellClassName: 'text-ink-dim',
    render: (je) => je.entry_date,
  },
  {
    key: 'period',
    header: 'Period',
    cellClassName: 'tabular-nums text-ink-dim',
    render: (je) => `${je.period_year}-${String(je.period_month).padStart(2, '0')}`,
  },
  {
    key: 'source',
    header: 'Source',
    cellClassName: 'uppercase text-ink-dim',
    render: (je) => je.source_type,
  },
  {
    key: 'status',
    header: 'Status',
    sortKey: 'status',
    render: (je) => <StatusBadge status={je.status} />,
  },
];

export function JournalEntriesListPage() {
  const flags = useOrgFlags();
  return flags.data[FEATURE_FLAGS.UI_LIST_TOOLBAR] ? (
    <JournalEntriesListToolbar />
  ) : (
    <JournalEntriesListLegacy />
  );
}

function JournalEntriesListToolbar() {
  const server = useServerList<JournalEntry>({
    enabled: true,
    queryKeyBase: journalEntryKeys.all,
    fetchPage: listJournalEntriesPage,
    defaultSort: { by: 'created_at', dir: 'desc' },
    facets: [{ key: 'status', label: 'Status', format: humaniseStatus }],
  });

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        title="Journal entries"
        actions={
          <Link to="/finance/journal-entries/new">
            <Button variant="primary">New journal entry</Button>
          </Link>
        }
      />

      <ListToolbar
        searchValue={server.searchInput}
        onSearchChange={server.setSearchInput}
        searchPlaceholder="Search entry number"
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
            {JOURNAL_ENTRY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humaniseStatus(s)}
              </option>
            ))}
          </Select>
        </label>
      </ListToolbar>

      <SavedViewsBar
        entityType="journal_entry"
        currentConfig={server.viewConfig}
        onApply={server.applyView}
      />

      {server.isError ? (
        <p className="text-accent font-sans">
          Journal entries unavailable for this org.
        </p>
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={server.rows}
            getRowKey={(je) => je.id}
            loading={server.isLoading}
            empty="No journal entries match these filters."
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
 * JournalEntriesListLegacy. Reverse-chronological list. The per-route
 * finance.journal_entries.enabled flag is server-enforced; the SPA renders
 * the 403 message inline when the flag is off.
 */
function JournalEntriesListLegacy() {
  const [page, setPage] = useState(0);
  const { data, isLoading, error } = useJournalEntries();

  const rows = data ?? [];
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  const meta =
    !isLoading && !error
      ? `${totalCount} ${totalCount === 1 ? 'entry' : 'entries'}`
      : undefined;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        title="Journal entries"
        meta={meta}
        actions={
          <Link to="/finance/journal-entries/new">
            <Button variant="primary">New journal entry</Button>
          </Link>
        }
      />

      {error ? (
        <p className="text-accent font-sans">
          {(error as Error).message ||
            'Journal entries unavailable for this org.'}
        </p>
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={pageRows}
            getRowKey={(je) => je.id}
            loading={isLoading}
            empty="No journal entries."
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
