// PaymentMethodsPage. 3PL sales config. Migration to the shared UI kit
// (F-Wave10-UI-KIT-01): PageHeader + DataTable + Pagination replace the
// hand-rolled header, link-as-button CTA, and table. default_for_org stays a
// plain Yes/No descriptor (it is a flag, not a lifecycle status).

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { paymentMethodsKeys } from '@/lib/queryKeys/paymentMethods';
import {
  listPaymentMethods,
  setDefaultPaymentMethod,
} from '@/lib/services/paymentMethodsService';
import type { PaymentMethod } from '@/lib/types/sales';

const PAGE_SIZE = 50;

export function PaymentMethodsPage() {
  const { data, isLoading } = useQuery({
    queryKey: paymentMethodsKeys.list(),
    queryFn: () => listPaymentMethods(),
  });
  const [page, setPage] = useState(0);
  const caps = useCapabilities();
  const queryClient = useQueryClient();

  // The server is authority; the cap only hides the button. The atomic-flip
  // RPC behind setDefaultPaymentMethod unsets the prior default in the same
  // statement, so we just invalidate the list on success.
  const setDefault = useMutation({
    mutationFn: (id: string) => setDefaultPaymentMethod(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: paymentMethodsKeys.list() });
    },
  });

  const canSetDefault = caps.can('payment_methods.method.set_default');

  const columns = useMemo<ReadonlyArray<DataColumn<PaymentMethod>>>(
    () => [
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
        key: 'set-default',
        header: '',
        align: 'right',
        render: (m) =>
          canSetDefault && !m.default_for_org ? (
            <button
              type="button"
              onClick={() => setDefault.mutate(m.id)}
              disabled={setDefault.isPending}
              className="text-xs text-ink-dim hover:text-accent disabled:opacity-50"
            >
              Set as default
            </button>
          ) : null,
      },
      {
        key: 'edit',
        header: '',
        align: 'right',
        render: (m) => (
          <Link
            to={`/settings/sales-config/payment-methods/${m.id}/edit`}
            className="text-xs text-ink-dim hover:text-accent"
          >
            Edit
          </Link>
        ),
      },
    ],
    [canSetDefault, setDefault],
  );

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
        eyebrow="Settings / Sales config / Payment methods"
        title="Payment methods"
        meta={meta}
        actions={
          <Link to="/settings/sales-config/payment-methods/new">
            <Button variant="primary">Add method</Button>
          </Link>
        }
      />
      <DataTable
        columns={columns}
        rows={pageRows}
        getRowKey={(m) => m.id}
        loading={isLoading}
        empty="No payment methods yet."
      />
      {setDefault.isError ? (
        <p className="font-sans text-sm text-accent">
          Failed to set the default payment method.
        </p>
      ) : null}
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
