// ImportHistoryPage. The org's CSV import-run ledger (import_jobs), newest
// first. Each row records the entity, outcome, row counts, and when. Imports
// are synchronous in this build; the ledger is written on every commit.

import { useQuery } from '@tanstack/react-query';

import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { PageHeader } from '@/components/ui/PageHeader';
import { listImportJobs } from '@/lib/services/importsService';
import type { ImportJob } from '@/lib/types/cross_cutting';

function statusClass(status: ImportJob['status']): string {
  if (status === 'completed') return 'text-success';
  if (status === 'failed') return 'text-accent';
  return 'text-ink-dim';
}

const COLUMNS: ReadonlyArray<DataColumn<ImportJob>> = [
  {
    key: 'when',
    header: 'When',
    cellClassName: 'text-ink-dim',
    render: (j) => new Date(j.created_at).toLocaleString(),
  },
  {
    key: 'entity',
    header: 'Entity',
    cellClassName: 'text-ink',
    render: (j) => j.entity_type,
  },
  {
    key: 'status',
    header: 'Status',
    render: (j) => <span className={statusClass(j.status)}>{j.status}</span>,
  },
  {
    key: 'inserted',
    header: 'Inserted',
    align: 'right',
    cellClassName: 'tabular-nums text-ink-dim',
    render: (j) => `${j.inserted_rows} / ${j.total_rows}`,
  },
  {
    key: 'errors',
    header: 'Errors',
    align: 'right',
    cellClassName: 'tabular-nums text-ink-dim',
    render: (j) => j.error_count,
  },
];

export function ImportHistoryPage() {
  const query = useQuery({
    queryKey: ['imports', 'jobs'],
    queryFn: listImportJobs,
    staleTime: 30_000,
  });
  const rows = query.data ?? [];

  return (
    <section className="mx-auto max-w-4xl px-6 py-8 flex flex-col gap-6">
      <PageHeader
        title="Import history"
        meta="Past CSV import runs for this workspace, newest first."
      />
      {query.isError ? (
        <p className="font-sans text-accent">Failed to load import history.</p>
      ) : (
        <DataTable
          columns={COLUMNS}
          rows={rows}
          getRowKey={(j) => j.id}
          loading={query.isLoading}
          empty="No imports yet. Run one from the Import wizard."
        />
      )}
    </section>
  );
}
