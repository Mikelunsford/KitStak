import { Link } from 'react-router-dom';

import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { Button } from '@/components/ui/Button';
import { useItemsList } from '@/lib/hooks/useItems';
import { formatCents } from '@/lib/money';

export function ItemsListPage() {
  const { data, isLoading, error } = useItemsList();
  return (
    <section className="px-8 py-12 max-w-6xl mx-auto flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-display tracking-wide text-ink">ITEMS</h1>
        <Link to="/3pl-operations/items/new">
          <Button variant="primary">New Item</Button>
        </Link>
      </header>
      {isLoading && <p className="text-ink-dim">Loading items.</p>}
      {error && <p className="text-accent">Failed to load items.</p>}
      {data && data.length === 0 ? (
        <ListEmptyState
          entity="item"
          explainer="Items are the SKUs you receive, build, and ship."
          addLabel="Add item"
          addTo="/3pl-operations/items/new"
        />
      ) : null}
      {data && data.length > 0 && (
        <table className="w-full border border-line">
          <thead className="bg-bg-2 text-left text-sm font-display tracking-wider text-ink">
            <tr>
              <th className="px-4 py-2">SKU</th>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Kind</th>
              <th className="px-4 py-2">Price</th>
              <th className="px-4 py-2">Active</th>
            </tr>
          </thead>
          <tbody>
            {data.map((item) => (
              <tr key={item.id} className="border-t border-line">
                <td className="px-4 py-2 font-mono text-sm">{item.sku}</td>
                <td className="px-4 py-2">
                  <Link
                    to={`/3pl-operations/items/${item.id}`}
                    className="text-ink hover:text-accent"
                  >
                    {item.name}
                  </Link>
                </td>
                <td className="px-4 py-2">{item.kind}</td>
                <td className="px-4 py-2 font-mono text-sm">
                  {formatCents(item.unit_price_cents, item.currency_code)}
                </td>
                <td className="px-4 py-2">{item.is_active ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
