// ExchangeRatesPage. 3PL sales config. Migration to the shared UI kit
// (F-Wave10-UI-KIT-01): PageHeader + DataTable + Pagination replace the
// hand-rolled header, link-as-button CTA, and table. The rate_e9 column stays a
// raw integer (String) rendering: it is a 1e-9 fixed-point rate scalar, NOT a
// money amount, so formatCents must never touch it.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { exchangeRatesKeys } from '@/lib/queryKeys/exchangeRates';
import { listExchangeRates } from '@/lib/services/exchangeRatesService';
import type { ExchangeRate } from '@/lib/types/sales';

const PAGE_SIZE = 50;

const COLUMNS: ReadonlyArray<DataColumn<ExchangeRate>> = [
  {
    key: 'base',
    header: 'Base',
    cellClassName: 'font-mono',
    render: (r) => r.base_currency_code,
  },
  {
    key: 'quote',
    header: 'Quote',
    cellClassName: 'font-mono',
    render: (r) => r.quote_currency_code,
  },
  {
    key: 'rate',
    header: 'Rate (1e-9)',
    align: 'right',
    cellClassName: 'font-mono',
    render: (r) => String(r.rate_e9),
  },
  {
    key: 'effective',
    header: 'Effective',
    cellClassName: 'font-mono text-ink-dim',
    render: (r) => r.effective_date,
  },
];

export function ExchangeRatesPage() {
  const { data, isLoading } = useQuery({
    queryKey: exchangeRatesKeys.list(),
    queryFn: () => listExchangeRates(),
  });
  const [page, setPage] = useState(0);

  const rows = data ?? [];
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  const meta = !isLoading
    ? `${totalCount} ${totalCount === 1 ? 'rate' : 'rates'}`
    : undefined;

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6 px-8 py-12">
      <PageHeader
        eyebrow="Sales config / Exchange rates"
        title="Exchange rates"
        meta={meta}
        actions={
          <Link to="/settings/sales-config/exchange-rates/new">
            <Button variant="primary">Add rate</Button>
          </Link>
        }
      />
      <DataTable
        columns={COLUMNS}
        rows={pageRows}
        getRowKey={(r) => r.id}
        loading={isLoading}
        empty="No exchange rates yet."
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
