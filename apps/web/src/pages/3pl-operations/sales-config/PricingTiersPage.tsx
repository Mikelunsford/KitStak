// PricingTiersPage. 3PL sales config. Migration to the shared UI kit
// (F-Wave10-UI-KIT-01): PageHeader + DataTable + Pagination replace the
// hand-rolled header, link-as-button CTA, and table. The discount column stays
// the basis-points-to-percent rendering (discount_bps / 100).toFixed(2)%: it is
// a rate, NOT a money amount, so formatCents must never touch it.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { pricingTiersKeys } from '@/lib/queryKeys/pricingTiers';
import { listPricingTiers } from '@/lib/services/pricingTiersService';
import type { PricingTier } from '@/lib/types/sales';

const PAGE_SIZE = 50;

const COLUMNS: ReadonlyArray<DataColumn<PricingTier>> = [
  {
    key: 'code',
    header: 'Code',
    cellClassName: 'font-mono',
    render: (t) => t.code,
  },
  {
    key: 'name',
    header: 'Name',
    render: (t) => t.name,
  },
  {
    key: 'discount',
    header: 'Discount',
    align: 'right',
    cellClassName: 'font-mono',
    render: (t) => `${(t.discount_bps / 100).toFixed(2)}%`,
  },
  {
    key: 'edit',
    header: '',
    align: 'right',
    render: (t) => (
      <Link
        to={`/settings/sales-config/pricing-tiers/${t.id}/edit`}
        className="text-xs text-ink-dim hover:text-accent"
      >
        Edit
      </Link>
    ),
  },
];

export function PricingTiersPage() {
  const { data, isLoading } = useQuery({
    queryKey: pricingTiersKeys.list(),
    queryFn: () => listPricingTiers(),
  });
  const [page, setPage] = useState(0);

  const rows = data ?? [];
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  const meta = !isLoading
    ? `${totalCount} ${totalCount === 1 ? 'tier' : 'tiers'}`
    : undefined;

  return (
    <section className="mx-auto flex max-w-3xl flex-col gap-6 px-8 py-12">
      <PageHeader
        eyebrow="Settings / Sales config / Pricing tiers"
        title="Pricing tiers"
        meta={meta}
        actions={
          <Link to="/settings/sales-config/pricing-tiers/new">
            <Button variant="primary">Add tier</Button>
          </Link>
        }
      />
      <DataTable
        columns={COLUMNS}
        rows={pageRows}
        getRowKey={(t) => t.id}
        loading={isLoading}
        empty="No pricing tiers yet."
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
