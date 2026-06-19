// JournalEntriesListPage. Finance. Migration to the shared UI kit
// (F-Wave10-UI-KIT-01): PageHeader + DataTable + StatusBadge + Pagination
// replace the hand-rolled header, table, raw uppercase status, and hand-rolled
// pager. Behavior preserved: the period format (YYYY-MM, zero-padded), the
// uppercase source, the number link to the detail, and the server-enforced
// finance.journal_entries.enabled flag error surfaced inline.

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { LINK_CLASS } from '@/components/data/entityLabelStyles';
import { useJournalEntries } from '@/lib/hooks/useJournalEntries';
import type { JournalEntry } from '@/lib/types/finance';

const PAGE_SIZE = 50;

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
    render: (je) => <StatusBadge status={je.status} />,
  },
];

/**
 * JournalEntriesListPage. Reverse-chronological list. The per-route
 * finance.journal_entries.enabled flag is server-enforced; the SPA renders
 * the 403 message inline when the flag is off.
 */
export function JournalEntriesListPage() {
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
        eyebrow="Finance / Journal entries"
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
