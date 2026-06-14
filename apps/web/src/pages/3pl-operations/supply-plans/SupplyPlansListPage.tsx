// SupplyPlansListPage (Wave 12 Phase A5). The Supply Plan list surface: shortage
// resolution for a project's material demand. Shared UI kit (PageHeader +
// FilterBar + DataTable + Pagination + StatusBadge) matching the Job Builders /
// Accounts list surfaces. The status filter narrows server-side (three-pl-api
// GET /supply-plans?status=). The create CTA is gated on
// threepl.supply_plan.create; the server is authority.

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { FilterBar } from '@/components/ui/FilterBar';
import { Select } from '@/components/ui/Select';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useSupplyPlansList } from '@/lib/hooks/useSupplyPlans';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import type { SupplyPlan, SupplyPlanStatus } from '@/lib/services/supplyPlansService';

const PAGE_SIZE = 50;

const COLUMNS: ReadonlyArray<DataColumn<SupplyPlan>> = [
  {
    key: 'number',
    header: 'Plan #',
    cellClassName: 'font-mono',
    render: (p) => (
      <Link
        to={`/3pl-operations/supply-plans/${p.id}`}
        className="text-ink hover:text-accent"
      >
        {p.plan_number ?? p.id.slice(0, 8)}
      </Link>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    render: (p) => <StatusBadge status={p.status} />,
  },
  {
    key: 'created',
    header: 'Created',
    cellClassName: 'font-mono text-ink-dim',
    render: (p) => p.created_at.slice(0, 10),
  },
];

export function SupplyPlansListPage() {
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
        eyebrow="3PL Operations"
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
