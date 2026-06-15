// WmsPutawayListPage (Wave 12 Body B Phase B3). The directed-putaway surface:
// tasks that move received stock from a dock to a final bin. Shared UI kit
// (PageHeader + FilterBar + DataTable + Pagination + StatusBadge) matching the
// Locations / Job Runs list surfaces. The status filter narrows the list
// server-side (wms-api GET /putaway?status=). The create CTA is gated on
// wms.putaway.create; the server is authority.

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { EntityLabel } from '@/components/data/EntityLabel';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { FilterBar } from '@/components/ui/FilterBar';
import { Select } from '@/components/ui/Select';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useWmsPutawayList } from '@/lib/hooks/useWmsPutaway';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import type {
  PutawayTask,
  PutawayTaskStatus,
} from '@/lib/services/wmsPutawayService';

const PAGE_SIZE = 50;

const COLUMNS: ReadonlyArray<DataColumn<PutawayTask>> = [
  {
    key: 'id',
    header: 'Task',
    cellClassName: 'font-mono',
    render: (t) => (
      <Link to={`/wms/putaway/${t.id}`} className="text-ink hover:text-accent">
        {t.id.slice(0, 8)}
      </Link>
    ),
  },
  {
    key: 'item',
    header: 'Item',
    cellClassName: 'text-ink-dim',
    render: (t) => <EntityLabel kind="item" id={t.item_id} />,
  },
  {
    key: 'qty',
    header: 'Qty',
    align: 'right',
    cellClassName: 'font-mono',
    render: (t) => Number(t.quantity).toFixed(2),
  },
  {
    key: 'warehouse',
    header: 'Warehouse',
    cellClassName: 'text-ink-dim',
    render: (t) => <EntityLabel kind="warehouse" id={t.warehouse_id} />,
  },
  {
    key: 'status',
    header: 'Status',
    render: (t) => <StatusBadge status={t.status} />,
  },
];

export function WmsPutawayListPage() {
  const [status, setStatus] = useState<PutawayTaskStatus | ''>('');
  const [page, setPage] = useState(0);

  const { data, isLoading, error } = useWmsPutawayList({
    ...(status ? { status } : {}),
  });
  const caps = useCapabilities();

  const rows = data ?? [];
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  const showOnboardingEmpty =
    !isLoading && !error && totalCount === 0 && !status;

  const meta =
    !isLoading && !error
      ? `${totalCount} ${totalCount === 1 ? 'task' : 'tasks'}`
      : undefined;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        eyebrow="WMS"
        title="Putaway"
        meta={meta}
        actions={
          caps.can('wms.putaway.create') ? (
            <Link to="/wms/putaway/new">
              <Button variant="primary">New putaway task</Button>
            </Link>
          ) : null
        }
      />

      <FilterBar>
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as PutawayTaskStatus | '');
            setPage(0);
          }}
          aria-label="Filter putaway tasks by status"
        >
          <option value="">All statuses</option>
          <option value="suggested">Suggested</option>
          <option value="in_progress">In progress</option>
          <option value="done">Done</option>
          <option value="cancelled">Cancelled</option>
        </Select>
      </FilterBar>

      {error ? (
        <p className="font-sans text-accent">Failed to load putaway tasks.</p>
      ) : showOnboardingEmpty ? (
        <ListEmptyState
          entity="putaway task"
          explainer="Putaway tasks move received stock from a dock to a final bin. Completing a task records the internal move so the bin stock reflects where the goods landed."
          addLabel="Add putaway task"
          addTo="/wms/putaway/new"
          canAdd={caps.can('wms.putaway.create')}
        />
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={pageRows}
            getRowKey={(t) => t.id}
            loading={isLoading}
            empty="No putaway tasks match this filter."
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
