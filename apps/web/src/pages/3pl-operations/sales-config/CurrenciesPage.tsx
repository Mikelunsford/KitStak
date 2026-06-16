// CurrenciesPage. 3PL sales config. Migration to the shared UI kit
// (F-Wave10-UI-KIT-01): PageHeader + DataTable replace the hand-rolled header
// and the card grid. Read-only reference list (no create/edit); the
// is_zero_decimal flag stays a plain descriptor.

import { useState } from 'react';

import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { useCurrenciesList } from '@/lib/hooks/useCurrencies';
import type { Currency } from '@/lib/types/sales';

const PAGE_SIZE = 50;

const COLUMNS: ReadonlyArray<DataColumn<Currency>> = [
  {
    key: 'code',
    header: 'Code',
    cellClassName: 'font-mono',
    render: (c) => c.code,
  },
  {
    key: 'name',
    header: 'Name',
    cellClassName: 'text-ink-dim',
    render: (c) => c.name,
  },
  {
    key: 'precision',
    header: 'Precision',
    cellClassName: 'text-ink-dim',
    render: (c) => (c.is_zero_decimal ? 'zero-decimal' : ''),
  },
];

export function CurrenciesPage() {
  const { data, isLoading } = useCurrenciesList();
  const [page, setPage] = useState(0);

  const rows = data ?? [];
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  const meta = !isLoading
    ? `${totalCount} ${totalCount === 1 ? 'currency' : 'currencies'}`
    : undefined;

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6 px-8 py-12">
      <PageHeader eyebrow="Settings / Sales config / Currencies" title="Currencies" meta={meta} />
      <DataTable
        columns={COLUMNS}
        rows={pageRows}
        getRowKey={(c) => c.code}
        loading={isLoading}
        empty="No currencies found."
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
