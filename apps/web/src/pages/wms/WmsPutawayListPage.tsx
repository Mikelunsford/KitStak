// WmsPutawayListPage (Wave 12 Body B Phase B3). The directed-putaway surface:
// tasks that move received stock from a dock to a final bin. UI scan Workstream C
// adds the server list toolbar (sortable headers, status facet, keyset pager,
// saved views) behind feature.list_toolbar. The flag-off path is the original
// client-state view, extracted verbatim into WmsPutawayListLegacy; the flag-on
// path is WmsPutawayListToolbar. The parent renders one or the other. Putaway
// tasks have no text identifier column, so the toolbar offers no free-text
// search (it sorts, facets, and pages). The create CTA is gated on
// wms.putaway.create; the server is authority.

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { EntityLabel } from '@/components/data/EntityLabel';
import { LINK_CLASS } from '@/components/data/entityLabelStyles';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { FilterBar } from '@/components/ui/FilterBar';
import { SavedViewsBar } from '@/components/ui/SavedViewsBar';
import { Select } from '@/components/ui/Select';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { CursorPager } from '@/components/ui/CursorPager';
import { StatusBadge, humaniseStatus } from '@/components/ui/StatusBadge';
import { useWmsPutawayList } from '@/lib/hooks/useWmsPutaway';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { useServerList } from '@/lib/hooks/useServerList';
import { listWmsPutawayPage } from '@/lib/services/wmsPutawayService';
import { wmsPutawayKeys } from '@/lib/queryKeys/wms';
import { FEATURE_FLAGS } from '@/lib/constants';
import type {
  PutawayTask,
  PutawayTaskStatus,
} from '@/lib/services/wmsPutawayService';

const PAGE_SIZE = 50;

const PUTAWAY_STATUSES = [
  'suggested',
  'in_progress',
  'done',
  'cancelled',
] as const;

const COLUMNS: ReadonlyArray<DataColumn<PutawayTask>> = [
  {
    key: 'id',
    header: 'Task',
    cellClassName: 'tabular-nums',
    render: (t) => (
      <Link to={`/wms/putaway/${t.id}`} className={LINK_CLASS}>
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
    cellClassName: 'tabular-nums',
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
    sortKey: 'status',
    render: (t) => <StatusBadge status={t.status} />,
  },
];

export function WmsPutawayListPage() {
  const flags = useOrgFlags();
  return flags.data[FEATURE_FLAGS.UI_LIST_TOOLBAR] ? (
    <WmsPutawayListToolbar />
  ) : (
    <WmsPutawayListLegacy />
  );
}

function WmsPutawayListToolbar() {
  const caps = useCapabilities();
  const server = useServerList<PutawayTask>({
    enabled: true,
    queryKeyBase: wmsPutawayKeys.all,
    fetchPage: listWmsPutawayPage,
    defaultSort: { by: 'created_at', dir: 'desc' },
    facets: [{ key: 'status', label: 'Status', format: humaniseStatus }],
  });

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        eyebrow="WMS"
        title="Putaway"
        actions={
          caps.can('wms.putaway.create') ? (
            <Link to="/wms/putaway/new">
              <Button variant="primary">New putaway task</Button>
            </Link>
          ) : null
        }
      />

      <FilterBar chips={server.chips} onClearAll={server.clearAll}>
        <label className="flex items-center gap-2">
          <span className="font-sans text-xs uppercase tracking-wide text-ink-dim">
            Status
          </span>
          <Select
            value={server.facetValues.status ?? ''}
            onChange={(e) => server.setFacet('status', e.target.value)}
            aria-label="Filter putaway tasks by status"
          >
            <option value="">All statuses</option>
            {PUTAWAY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humaniseStatus(s)}
              </option>
            ))}
          </Select>
        </label>
      </FilterBar>

      <SavedViewsBar
        entityType="putaway_task"
        currentConfig={server.viewConfig}
        onApply={server.applyView}
      />

      {server.isError ? (
        <p className="font-sans text-accent">Failed to load putaway tasks.</p>
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={server.rows}
            getRowKey={(t) => t.id}
            loading={server.isLoading}
            empty="No putaway tasks match these filters."
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

function WmsPutawayListLegacy() {
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
