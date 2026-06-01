import { Link, useParams } from 'react-router-dom';

import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import { useItem } from '@/lib/hooks/useItems';
import { formatCents } from '@/lib/money';

export function ItemDetailPage() {
  const { id } = useParams();
  const { data, isLoading, error } = useItem(id);
  if (isLoading) return <p className="p-8 text-ink-dim">Loading.</p>;
  if (error || !data) return <p className="p-8 text-accent">Item not found.</p>;
  return (
    <section className="px-8 py-12 max-w-3xl mx-auto flex flex-col gap-6">
      <Breadcrumbs
        items={[
          { label: 'Items', to: '/3pl-operations/items' },
          { label: data.sku },
        ]}
      />
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-4xl font-display tracking-wide text-ink">{data.name}</h1>
        <Link
          to={`/3pl-operations/items/${data.id}/edit`}
          className="px-4 py-2 bg-bg-2 border border-line font-display tracking-wider"
        >
          EDIT
        </Link>
      </header>
      <dl className="grid grid-cols-2 gap-x-8 gap-y-3 font-sans text-ink">
        <dt className="text-ink-dim">SKU</dt>
        <dd className="font-mono">{data.sku}</dd>
        <dt className="text-ink-dim">Kind</dt>
        <dd>{data.kind}</dd>
        <dt className="text-ink-dim">Unit price</dt>
        <dd className="font-mono">{formatCents(data.unit_price_cents, data.currency_code)}</dd>
        <dt className="text-ink-dim">Currency</dt>
        <dd>{data.currency_code}</dd>
        <dt className="text-ink-dim">Active</dt>
        <dd>{data.is_active ? 'Yes' : 'No'}</dd>
        <dt className="text-ink-dim">Taxable</dt>
        <dd>{data.is_taxable ? 'Yes' : 'No'}</dd>
      </dl>
      {data.description && <p className="text-ink-dim">{data.description}</p>}
    </section>
  );
}
