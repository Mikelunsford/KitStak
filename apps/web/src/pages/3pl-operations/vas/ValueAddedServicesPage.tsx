// ValueAddedServicesPage. 3PL value-added services catalog. Migration to the
// shared UI kit (F-Wave10-UI-KIT-01): PageHeader + DataTable + Pagination
// replace the hand-rolled header, link-as-button CTA, and table. Base price
// keeps its formatCents rendering with the per-row currency_code. VAS is a
// billable-service catalog, so it sits in the LIBRARY job-mode.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { vasKeys } from '@/lib/queryKeys/vas';
import { listValueAddedServices } from '@/lib/services/vasService';
import { formatCents } from '@/lib/money';
import type { ValueAddedService } from '@/lib/types/sales';

const PAGE_SIZE = 50;

const COLUMNS: ReadonlyArray<DataColumn<ValueAddedService>> = [
  {
    key: 'code',
    header: 'Code',
    cellClassName: 'font-mono',
    render: (v) => v.code,
  },
  {
    key: 'name',
    header: 'Name',
    render: (v) => v.name,
  },
  {
    key: 'kind',
    header: 'Kind',
    cellClassName: 'text-ink-dim',
    render: (v) => v.kind,
  },
  {
    key: 'base_price',
    header: 'Base price',
    align: 'right',
    cellClassName: 'font-mono',
    render: (v) => formatCents(v.base_price_cents, v.currency_code),
  },
  {
    key: 'edit',
    header: '',
    align: 'right',
    render: (v) => (
      <Link
        to={`/catalog/vas/${v.id}/edit`}
        className="text-xs text-ink-dim hover:text-accent"
      >
        Edit
      </Link>
    ),
  },
];

export function ValueAddedServicesPage() {
  const { data, isLoading } = useQuery({
    queryKey: vasKeys.list(),
    queryFn: () => listValueAddedServices(),
  });
  const [page, setPage] = useState(0);

  const rows = data ?? [];
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  const meta = !isLoading
    ? `${totalCount} ${totalCount === 1 ? 'service' : 'services'}`
    : undefined;

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6 px-8 py-12">
      <PageHeader
        eyebrow="Library / Value added services"
        title="Value added services"
        meta={meta}
        actions={
          <Link to="/catalog/vas/new">
            <Button variant="primary">Add service</Button>
          </Link>
        }
      />
      <DataTable
        columns={COLUMNS}
        rows={pageRows}
        getRowKey={(v) => v.id}
        loading={isLoading}
        empty="No value added services yet."
      />
      {totalCount > PAGE_SIZE ? (
        <Pagination
          page={page}
          totalCount={totalCount}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
        />
      ) : null}
    </section>
  );
}
