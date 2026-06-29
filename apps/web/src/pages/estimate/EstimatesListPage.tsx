// EstimatesListPage. The home for saved estimates (drafts and converted),
// mirroring the shared list-page kit (PageHeader + DataTable + Pagination).

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { formatCents } from '@/lib/money';
import { FAMILIES } from '@/lib/estimate/families';
import { useEstimatesList } from '@/lib/hooks/useEstimates';
import type { Estimate } from '@/lib/types/estimate';

const PAGE_SIZE = 50;

function familyLabel(key: string): string {
  return (FAMILIES as Record<string, { label: string } | undefined>)[key]?.label ?? key;
}

const COLUMNS: ReadonlyArray<DataColumn<Estimate>> = [
  {
    key: 'name',
    header: 'Name',
    render: (e) => e.name,
  },
  {
    key: 'family',
    header: 'Family',
    render: (e) => familyLabel(e.family),
  },
  {
    key: 'status',
    header: 'Status',
    render: (e) => <span className="uppercase tracking-wide text-xs text-ink-dim">{e.status}</span>,
  },
  {
    key: 'total',
    header: 'Total',
    align: 'right',
    cellClassName: 'tabular-nums',
    render: (e) => formatCents(e.total_cents, e.currency_code),
  },
  {
    key: 'action',
    header: '',
    align: 'right',
    render: (e) => {
      if (e.status === 'draft') {
        return (
          <Link to={`/estimates/${e.id}/edit`} className="text-xs text-ink-dim hover:text-accent">
            Edit
          </Link>
        );
      }
      if (e.status === 'converted' && e.converted_to_quote_id) {
        return (
          <Link to={`/quotes/${e.converted_to_quote_id}`} className="text-xs text-ink-dim hover:text-accent">
            View quote
          </Link>
        );
      }
      return <span className="text-xs text-ink-faint">-</span>;
    },
  },
];

export function EstimatesListPage() {
  const { data, isLoading } = useEstimatesList();
  const [page, setPage] = useState(0);

  const rows = data ?? [];
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  const meta = !isLoading
    ? `${totalCount} ${totalCount === 1 ? 'estimate' : 'estimates'}`
    : undefined;

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6 px-8 py-12">
      <PageHeader
        title="Estimates"
        meta={meta}
        actions={
          <Link to="/estimates/new">
            <Button variant="primary">New estimate</Button>
          </Link>
        }
      />
      <DataTable
        columns={COLUMNS}
        rows={pageRows}
        getRowKey={(e) => e.id}
        loading={isLoading}
        empty="No estimates yet. Start one with New estimate."
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
