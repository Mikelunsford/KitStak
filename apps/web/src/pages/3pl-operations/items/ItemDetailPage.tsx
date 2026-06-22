import { Link, useParams } from 'react-router-dom';

import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useItem } from '@/lib/hooks/useItems';
import { formatCents } from '@/lib/money';
import { SUPPLY_SOURCE_LABEL, isZeroCostSupplySource } from '@/lib/supplySource';

export function ItemDetailPage() {
  const { id } = useParams();
  const { data, isLoading, error } = useItem(id);
  if (isLoading) return <p className="p-8 text-ink-dim">Loading.</p>;
  if (error || !data) return <p className="p-8 text-accent">Item not found.</p>;
  return (
    <section className="px-8 py-12 max-w-3xl mx-auto flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: 'Items', to: '/catalog/items' },
          { label: data.sku },
        ]}
      />
      <PageHeader
        title={data.name}
        actions={
          <Link to={`/catalog/items/${data.id}/edit`}>
            <Button variant="secondary">Edit</Button>
          </Link>
        }
      />
      <dl className="grid grid-cols-2 gap-x-8 gap-y-3 font-sans text-ink">
        <dt className="text-ink-dim">SKU</dt>
        <dd className="font-mono">{data.sku}</dd>
        <dt className="text-ink-dim">Kind</dt>
        <dd>{data.kind}</dd>
        <dt className="text-ink-dim">Unit price</dt>
        <dd className="tabular-nums">{formatCents(data.unit_price_cents, data.currency_code)}</dd>
        <dt className="text-ink-dim">Cost</dt>
        <dd className="tabular-nums">
          {data.cost_cents !== null
            ? formatCents(data.cost_cents, data.currency_code)
            : '·'}
          {isZeroCostSupplySource(data.supply_source) && (
            <span className="ml-2 font-sans text-xs text-ink-dim">
              zero org material cost
            </span>
          )}
        </dd>
        <dt className="text-ink-dim">Supply source</dt>
        <dd>{SUPPLY_SOURCE_LABEL[data.supply_source]}</dd>
        <dt className="text-ink-dim">Unit of measure</dt>
        <dd>{data.unit_of_measure ?? '·'}</dd>
        <dt className="text-ink-dim">Reorder point</dt>
        <dd className="tabular-nums">
          {data.reorder_point !== null ? String(data.reorder_point) : '·'}
        </dd>
        <dt className="text-ink-dim">Barcode / UPC</dt>
        <dd className="font-mono">{data.barcode ?? '·'}</dd>
        <dt className="text-ink-dim">Currency</dt>
        <dd>{data.currency_code}</dd>
        <dt className="text-ink-dim">Active</dt>
        <dd><StatusBadge status={data.is_active ? 'active' : 'inactive'} /></dd>
        <dt className="text-ink-dim">Taxable</dt>
        <dd>{data.is_taxable ? 'Yes' : 'No'}</dd>
      </dl>
      {data.description && <p className="text-ink-dim">{data.description}</p>}
    </section>
  );
}
