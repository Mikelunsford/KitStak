// SupplyPlansListPage (Wave 12 Phase A5). The Supply Plan list surface: shortage
// resolution for a project's material demand. Workstream C of the 2026-06-17 UI
// scan adds the server list toolbar (search on plan number, sortable headers,
// status facet, keyset pager, saved views) behind feature.list_toolbar. The
// flag-off path is the original client-state view (PageHeader + FilterBar +
// Select + DataTable + StatusBadge + Pagination), extracted verbatim into
// SupplyPlansListLegacy; the flag-on path is SupplyPlansListToolbar. The parent
// renders one or the other. The create CTA is gated on threepl.supply_plan.create
// in both paths; the server is authority.

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { LINK_CLASS } from '@/components/data/entityLabelStyles';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { FilterBar } from '@/components/ui/FilterBar';
import { ListToolbar } from '@/components/ui/ListToolbar';
import { SavedViewsBar } from '@/components/ui/SavedViewsBar';
import { Select } from '@/components/ui/Select';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { CursorPager } from '@/components/ui/CursorPager';
import { StatusBadge, humaniseStatus } from '@/components/ui/StatusBadge';
import { useSupplyPlansList } from '@/lib/hooks/useSupplyPlans';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { useServerList } from '@/lib/hooks/useServerList';
import { listSupplyPlansPage } from '@/lib/services/supplyPlansService';
import { supplyPlansKeys } from '@/lib/queryKeys/threepl';
import { FEATURE_FLAGS } from '@/lib/constants';
import type { SupplyPlan, SupplyPlanStatus } from '@/lib/services/supplyPlansService';

const PAGE_SIZE = 50;

const SUPPLY_PLAN_STATUSES: ReadonlyArray<SupplyPlanStatus> = [
  'draft',
  'released',
  'fulfilled',
  'cancelled',
];

const COLUMNS: ReadonlyArray<DataColumn<SupplyPlan>> = [
  {
    key: 'number',
    header: 'Plan #',
    cellClassName: 'tabular-nums',
    render: (p) => (
      <Link
        to={`/3pl-operations/supply-plans/${p.id}`}
        className={LINK_CLASS}
      >
        {p.plan_number ?? p.id.slice(0, 8)}
      </Link>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    sortKey: 'status',
    render: (p) => <StatusBadge status={p.status} />,
  },
  {
    key: 'created',
    header: 'Created',
    sortKey: 'created_at',
    cellClassName: 'tabular-nums text-ink-dim',
    render: (p) => p.created_at.slice(0, 10),
  },
];

export function SupplyPlansListPage() {
  const flags = useOrgFlags();
  return flags.data[FEATURE_FLAGS.UI_LIST_TOOLBAR] ? (
    <SupplyPlansListToolbar />
  ) : (
    <SupplyPlansListLegacy />
  );
}

function SupplyPlansListToolbar() {
  const caps = useCapabilities();
  const server = useServerList<SupplyPlan>({
    enabled: true,
    queryKeyBase: supplyPlansKeys.all,
    fetchPage: listSupplyPlansPage,
    defaultSort: { by: 'created_at', dir: 'desc' },
    facets: [{ key: 'status', label: 'Status', format: humaniseStatus }],
  });

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        title="Supply Plans"
        actions={
          caps.can('threepl.supply_plan.create') ? (
            <Link to="/3pl-operations/supply-plans/new">
              <Button variant="primary">New supply plan</Button>
            </Link>
          ) : null
        }
      />

      <ListToolbar
        searchValue={server.searchInput}
        onSearchChange={server.setSearchInput}
        searchPlaceholder="Search plan number"
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
            aria-label="Filter supply plans by status"
          >
            <option value="">All statuses</option>
            {SUPPLY_PLAN_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humaniseStatus(s)}
              </option>
            ))}
          </Select>
        </label>
      </ListToolbar>

      <SavedViewsBar
        entityType="supply_plan"
        currentConfig={server.viewConfig}
        onApply={server.applyView}
      />

      {server.isError ? (
        <p className="font-sans text-accent">Failed to load supply plans.</p>
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={server.rows}
            getRowKey={(p) => p.id}
            loading={server.isLoading}
            empty="No supply plans match these filters."
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

function SupplyPlansListLegacy() {
  const [status, setStatus] = useState<SupplyPlanStatus | ''>('');
  const [page, setPage] = useState(0);

  const { data, isLoading, error } = useSupplyPlansList({
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
      ? `${totalCount} ${totalCount === 1 ? 'supply plan' : 'supply plans'}`
      : undefined;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        title="Supply Plans"
        meta={meta}
        actions={
          caps.can('threepl.supply_plan.create') ? (
            <Link to="/3pl-operations/supply-plans/new">
              <Button variant="primary">New supply plan</Button>
            </Link>
          ) : null
        }
      />

      <FilterBar>
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as SupplyPlanStatus | '');
            setPage(0);
          }}
          aria-label="Filter supply plans by status"
        >
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="released">Released</option>
          <option value="fulfilled">Fulfilled</option>
          <option value="cancelled">Cancelled</option>
        </Select>
      </FilterBar>

      {error ? (
        <p className="font-sans text-accent">Failed to load supply plans.</p>
      ) : showOnboardingEmpty ? (
        <ListEmptyState
          entity="supply plan"
          explainer="Supply plans resolve a project's material demand against on-hand stock: release reserves what is available and surfaces the shortage to cover by inbound, purchase, or replenishment."
          addLabel="Add supply plan"
          addTo="/3pl-operations/supply-plans/new"
          canAdd={caps.can('threepl.supply_plan.create')}
        />
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={pageRows}
            getRowKey={(p) => p.id}
            loading={isLoading}
            empty="No supply plans match this filter."
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
