// ProductionRunsListPage. 3PL production. Migration to the shared UI kit
// (F-Wave10-UI-KIT-01): PageHeader + DataTable + StatusBadge + Pagination
// replace the hand-rolled header, raw status pill, table, and link-as-button
// CTA. Behavior preserved: the create CTA stays gated on production.run.create,
// and the onboarding ListEmptyState shows when the list is empty.

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { EntityLabel } from '@/components/data/EntityLabel';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useProductionRunsList } from '@/lib/hooks/useOps';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import type { ProductionRun } from '@/lib/types/vendors_inventory_ops';

const PAGE_SIZE = 50;

const COLUMNS: ReadonlyArray<DataColumn<ProductionRun>> = [
  {
    key: 'run',
    header: '#',
    cellClassName: 'font-mono',
    render: (r) => (
      <Link
        to={`/3pl-operations/production/${r.id}`}
        className="text-ink hover:text-accent"
      >
        {r.run_number ?? r.id.slice(0, 8)}
      </Link>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    render: (r) => <StatusBadge status={r.status} />,
  },
  {
    key: 'output',
    header: 'Output item',
    cellClassName: 'text-ink-dim',
    render: (r) => <EntityLabel kind="item" id={r.output_item_id} />,
  },
  {
    key: 'planned',
    header: 'Planned',
    align: 'right',
    cellClassName: 'font-mono text-ink-dim',
    render: (r) => String(r.quantity_planned),
  },
  {
    key: 'produced',
    header: 'Produced',
    align: 'right',
    cellClassName: 'font-mono text-ink-dim',
    render: (r) => String(r.quantity_produced),
  },
];

export function ProductionRunsListPage() {
  const { data, isLoading } = useProductionRunsList();
  const caps = useVioCapabilities();
  const [page, setPage] = useState(0);

  const rows = data ?? [];
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  const meta = !isLoading
    ? `${totalCount} ${totalCount === 1 ? 'run' : 'runs'}`
    : undefined;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        eyebrow="Make / Production runs"
        title="Production runs"
        meta={meta}
        actions={
          caps.can('production.run.create') ? (
            <Link to="/3pl-operations/production/new">
              <Button variant="primary">New production run</Button>
            </Link>
          ) : undefined
        }
      />

      {!isLoading && totalCount === 0 ? (
        <ListEmptyState
          entity="production run"
          explainer="Production runs convert raw materials into finished kits."
          addLabel="Add production run"
          addTo="/3pl-operations/production/new"
          canAdd={caps.can('production.run.create')}
        />
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={pageRows}
            getRowKey={(r) => r.id}
            loading={isLoading}
            empty="No production runs."
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
