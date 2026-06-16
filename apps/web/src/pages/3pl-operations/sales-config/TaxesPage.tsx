// TaxesPage. 3PL sales config. Migration to the shared UI kit
// (F-Wave10-UI-KIT-01): PageHeader + DataTable + Pagination replace the
// hand-rolled header, link-as-button CTA, and table. The rate column stays the
// basis-points-to-percent rendering (rate_bps / 100).toFixed(2)%: it is a rate,
// NOT a money amount. default_for_org stays a plain Yes/No descriptor.

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { useTaxesList } from '@/lib/hooks/useTaxes';
import type { Tax } from '@/lib/types/sales';

const PAGE_SIZE = 50;

const COLUMNS: ReadonlyArray<DataColumn<Tax>> = [
  {
    key: 'code',
    header: 'Code',
    cellClassName: 'font-mono',
    render: (tax) => tax.code,
  },
  {
    key: 'name',
    header: 'Name',
    render: (tax) => tax.name,
  },
  {
    key: 'rate',
    header: 'Rate',
    align: 'right',
    cellClassName: 'font-mono',
    render: (tax) => `${(tax.rate_bps / 100).toFixed(2)}%`,
  },
  {
    key: 'default',
    header: 'Default',
    cellClassName: 'text-ink-dim',
    render: (tax) => (tax.default_for_org ? 'Yes' : 'No'),
  },
  {
    key: 'edit',
    header: '',
    align: 'right',
    render: (tax) => (
      <Link
        to={`/settings/sales-config/taxes/${tax.id}/edit`}
        className="text-xs text-ink-dim hover:text-accent"
      >
        Edit
      </Link>
    ),
  },
];

export function TaxesPage() {
  const { data, isLoading, error } = useTaxesList();
  const [page, setPage] = useState(0);

  const rows = data ?? [];
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  const meta =
    !isLoading && !error
      ? `${totalCount} ${totalCount === 1 ? 'tax' : 'taxes'}`
      : undefined;

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6 px-8 py-12">
      <PageHeader
        eyebrow="Settings / Sales config / Taxes"
        title="Taxes"
        meta={meta}
        actions={
          <Link to="/settings/sales-config/taxes/new">
            <Button variant="primary">Add tax</Button>
          </Link>
        }
      />
      {error ? (
        <p className="font-sans text-sm text-accent">Failed to load taxes.</p>
      ) : null}
      <DataTable
        columns={COLUMNS}
        rows={pageRows}
        getRowKey={(tax) => tax.id}
        loading={isLoading}
        empty="No taxes yet."
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
