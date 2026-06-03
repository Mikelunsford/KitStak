// PaymentMethodsPage. 3PL sales config. Migration to the shared UI kit
// (F-Wave10-UI-KIT-01): PageHeader + DataTable + Pagination replace the
// hand-rolled header, link-as-button CTA, and table. default_for_org stays a
// plain Yes/No descriptor (it is a flag, not a lifecycle status).

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { paymentMethodsKeys } from '@/lib/queryKeys/paymentMethods';
import { listPaymentMethods } from '@/lib/services/paymentMethodsService';
import type { PaymentMethod } from '@/lib/types/sales';

const PAGE_SIZE = 50;

const COLUMNS: ReadonlyArray<DataColumn<PaymentMethod>> = [
  {
    key: 'code',
    header: 'Code',
    cellClassName: 'font-mono',
    render: (m) => m.code,
  },
  {
    key: 'label',
    header: 'Label',
    render: (m) => m.label,
  },
  {
    key: 'kind',
    header: 'Kind',
    cellClassName: 'text-ink-dim',
    render: (m) => m.kind,
  },
  {
    key: 'default',
    header: 'Default',
    cellClassName: 'text-ink-dim',
    render: (m) => (m.default_for_org ? 'Yes' : 'No'),
  },
  {
    key: 'edit',
    header: '',
    align: 'right',
    render: (m) => (
      <Link
        to={`/3pl-operations/sales-config/payment-methods/${m.id}/edit`}
        className="text-xs text-ink-dim hover:text-accent"
      >
        Edit
      </Link>
    ),
  },
];

export function PaymentMethodsPage() {
  const { data, isLoading } = useQuery({
    queryKey: paymentMethodsKeys.list(),
    queryFn: () => listPaymentMethods(),
  });
  const [page, setPage] = useState(0);

  const rows = data ?? [];
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  const meta = !isLoading
    ? `${totalCount} ${totalCount === 1 ? 'method' : 'methods'}`
    : undefined;

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6 px-8 py-12">
      <PageHeader
        eyebrow="Sales config / Payment methods"
        title="Payment methods"
        meta={meta}
        actions={
          <Link to="/3pl-operations/sales-config/payment-methods/new">
            <Button variant="primary">Add method</Button>
          </Link>
        }
      />
      <DataTable
        columns={COLUMNS}
        rows={pageRows}
        getRowKey={(m) => m.id}
        loading={isLoading}
        empty="No payment methods yet."
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
