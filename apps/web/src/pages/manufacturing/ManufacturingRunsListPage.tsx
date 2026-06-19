// ManufacturingRunsListPage. Pillar 2. Migration to the shared UI kit
// (F-Wave10-UI-KIT-01): PageHeader + FilterBar + Select + DataTable +
// StatusBadge + Pagination replace the hand-rolled header, filter selects,
// table, and raw status pill. Behavior preserved: the ?status= deep-link from
// the dashboard work card seeds the filter, the create CTAs stay gated
// (Build from BOM additionally needs line_item.create), and the onboarding
// ListEmptyState shows only when unfiltered.

import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { EntityLabel } from '@/components/data/EntityLabel';
import { LINK_CLASS } from '@/components/data/entityLabelStyles';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { FilterBar, type FilterChip } from '@/components/ui/FilterBar';
import { Select } from '@/components/ui/Select';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { StatusBadge, humaniseStatus } from '@/components/ui/StatusBadge';
import { useManufacturingRunsList } from '@/lib/hooks/useManufacturing';
import { useWarehousesList } from '@/lib/hooks/useInventory';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import type {
  ManufacturingRun,
  ManufacturingRunStatus,
} from '@/lib/types/vendors_inventory_ops';

const PAGE_SIZE = 50;

type StatusFilter = ManufacturingRunStatus | 'all';

const ALLOWED_RUN_STATUSES = new Set<string>([
  'draft',
  'started',
  'completed',
  'cancelled',
]);

const RUN_STATUSES: ManufacturingRunStatus[] = [
  'draft',
  'started',
  'completed',
  'cancelled',
];

function parseRunStatusParam(raw: string | null): StatusFilter {
  if (raw && ALLOWED_RUN_STATUSES.has(raw)) {
    return raw as ManufacturingRunStatus;
  }
  return 'all';
}

const COLUMNS: ReadonlyArray<DataColumn<ManufacturingRun>> = [
  {
    key: 'run',
    header: 'Run',
    cellClassName: 'tabular-nums',
    render: (r) => (
      <Link to={`/manufacturing/runs/${r.id}`} className={LINK_CLASS}>
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
    key: 'project',
    header: 'Project',
    cellClassName: 'text-ink-dim',
    render: (r) =>
      r.project_id ? <EntityLabel kind="project" id={r.project_id} /> : '·',
  },
  {
    key: 'warehouse',
    header: 'Warehouse',
    cellClassName: 'text-ink-dim',
    render: (r) => <EntityLabel kind="warehouse" id={r.warehouse_id} />,
  },
  {
    key: 'start',
    header: 'Planned start',
    cellClassName: 'text-ink-dim',
    render: (r) => r.planned_start_at ?? '',
  },
  {
    key: 'created',
    header: 'Created',
    cellClassName: 'text-ink-dim',
    render: (r) => r.created_at.slice(0, 10),
  },
];

export function ManufacturingRunsListPage() {
  // UX-Q5: support ?status= deep-links from the dashboard work card
  // ("Runs in production" -> ?status=started). Filter is preserved as
  // local state once the page mounts so the operator can change it.
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<StatusFilter>(() =>
    parseRunStatusParam(searchParams.get('status')),
  );
  const [warehouseId, setWarehouseId] = useState<string>('');
  const [page, setPage] = useState(0);

  const filters = useMemo(() => {
    const f: { status?: StatusFilter; warehouse_id?: string } = {};
    if (status !== 'all') f.status = status;
    if (warehouseId) f.warehouse_id = warehouseId;
    return f;
  }, [status, warehouseId]);

  const runs = useManufacturingRunsList(filters);
  const warehouses = useWarehousesList();
  const caps = useVioCapabilities();

  function applyStatus(next: StatusFilter) {
    setStatus(next);
    setPage(0);
  }

  function applyWarehouse(next: string) {
    setWarehouseId(next);
    setPage(0);
  }

  const warehouseName = useMemo(() => {
    const map: Record<string, string> = {};
    for (const w of warehouses.data ?? [])
      map[w.id] = `${w.code} · ${w.display_name}`;
    return map;
  }, [warehouses.data]);

  const rows = runs.data ?? [];
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  const meta =
    !runs.isLoading && !runs.error
      ? `${totalCount} ${totalCount === 1 ? 'run' : 'runs'}`
      : undefined;

  const chips: FilterChip[] = [];
  if (status !== 'all') {
    chips.push({
      key: 'status',
      label: `Status: ${humaniseStatus(status)}`,
      onClear: () => applyStatus('all'),
    });
  }
  if (warehouseId) {
    chips.push({
      key: 'warehouse',
      label: `Warehouse: ${warehouseName[warehouseId] ?? warehouseId}`,
      onClear: () => applyWarehouse(''),
    });
  }

  const showOnboardingEmpty =
    !runs.isLoading &&
    !runs.error &&
    totalCount === 0 &&
    status === 'all' &&
    !warehouseId;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        eyebrow="Manufacturing / Runs"
        title="Manufacturing runs"
        meta={meta}
        actions={
          caps.can('manufacturing.run.create') ? (
            <>
              {caps.can('manufacturing.run.line_item.create') ? (
                <Link to="/manufacturing/runs/from-bom">
                  <Button variant="secondary">Build from BOM</Button>
                </Link>
              ) : null}
              <Link to="/manufacturing/runs/new">
                <Button variant="primary">New manufacturing run</Button>
              </Link>
            </>
          ) : undefined
        }
      />

      <FilterBar chips={chips}>
        <label className="flex items-center gap-2">
          <span className="font-sans text-xs text-ink-dim tracking-wide uppercase">
            Status
          </span>
          <Select
            value={status}
            onChange={(e) => applyStatus(e.target.value as StatusFilter)}
            aria-label="Filter by status"
          >
            <option value="all">All</option>
            {RUN_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humaniseStatus(s)}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex items-center gap-2">
          <span className="font-sans text-xs text-ink-dim tracking-wide uppercase">
            Warehouse
          </span>
          <Select
            value={warehouseId}
            onChange={(e) => applyWarehouse(e.target.value)}
            disabled={warehouses.isLoading}
            aria-label="Filter by warehouse"
          >
            <option value="">All warehouses</option>
            {(warehouses.data ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} · {w.display_name}
              </option>
            ))}
          </Select>
        </label>
      </FilterBar>

      {runs.error ? (
        <p className="text-accent font-sans text-sm">
          {runs.error instanceof Error
            ? runs.error.message
            : 'Failed to load manufacturing runs.'}
        </p>
      ) : showOnboardingEmpty ? (
        <ListEmptyState
          entity="manufacturing run"
          explainer="Manufacturing runs convert raw materials into finished kits."
          addLabel="Add manufacturing run"
          addTo="/manufacturing/runs/new"
          canAdd={caps.can('manufacturing.run.create')}
        />
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={pageRows}
            getRowKey={(r) => r.id}
            loading={runs.isLoading}
            empty="No manufacturing runs match the current filters."
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
