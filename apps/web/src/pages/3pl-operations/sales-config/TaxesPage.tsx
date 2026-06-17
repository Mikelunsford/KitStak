// TaxesPage. 3PL sales config. Migration to the shared UI kit
// (F-Wave10-UI-KIT-01): PageHeader + DataTable + Pagination replace the
// hand-rolled header, link-as-button CTA, and table. The rate column stays the
// basis-points-to-percent rendering (rate_bps / 100).toFixed(2)%: it is a rate,
// NOT a money amount. default_for_org stays a plain Yes/No descriptor.

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { useTaxesList } from '@/lib/hooks/useTaxes';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { setDefaultTax } from '@/lib/services/taxesService';
import { taxesKeys } from '@/lib/queryKeys/taxes';
import type { Tax } from '@/lib/types/sales';

const PAGE_SIZE = 50;

export function TaxesPage() {
  const { data, isLoading, error } = useTaxesList();
  const [page, setPage] = useState(0);
  const caps = useCapabilities();
  const queryClient = useQueryClient();

  // The server is authority; the cap only hides the button. The atomic-flip
  // RPC behind setDefaultTax unsets the prior default in the same statement,
  // so we just invalidate the list on success to re-read the new default.
  const setDefault = useMutation({
    mutationFn: (id: string) => setDefaultTax(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: taxesKeys.list() });
    },
  });

  const canSetDefault = caps.can('taxes.tax.set_default');

  const columns = useMemo<ReadonlyArray<DataColumn<Tax>>>(
    () => [
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
        key: 'set-default',
        header: '',
        align: 'right',
        render: (tax) =>
          canSetDefault && !tax.default_for_org ? (
            <button
              type="button"
              onClick={() => setDefault.mutate(tax.id)}
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
        render: (tax) => (
          <Link
            to={`/settings/sales-config/taxes/${tax.id}/edit`}
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
        columns={columns}
        rows={pageRows}
        getRowKey={(tax) => tax.id}
        loading={isLoading}
        empty="No taxes yet."
      />
      {setDefault.isError ? (
        <p className="font-sans text-sm text-accent">Failed to set the default tax.</p>
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
