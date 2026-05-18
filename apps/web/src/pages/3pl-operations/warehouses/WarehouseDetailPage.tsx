import { useParams } from 'react-router-dom';
import { useWarehouse } from '@/lib/hooks/useInventory';

export function WarehouseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error } = useWarehouse(id);
  if (isLoading) return <p className="px-8 py-12 text-ink-dim">Loading.</p>;
  if (error || !data) return <p className="px-8 py-12 text-accent">Warehouse not found.</p>;
  return (
    <section className="px-8 py-12 max-w-3xl mx-auto flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">{data.display_name}</h1>
      <dl className="grid grid-cols-2 gap-4 font-sans text-sm">
        <dt className="text-ink-dim">Code</dt><dd className="text-ink">{data.code}</dd>
        <dt className="text-ink-dim">Default</dt><dd className="text-ink">{data.is_default ? 'Yes' : 'No'}</dd>
        <dt className="text-ink-dim">Active</dt><dd className="text-ink">{data.is_active ? 'Yes' : 'No'}</dd>
        <dt className="text-ink-dim">City</dt><dd className="text-ink">{data.city ?? ''}</dd>
        <dt className="text-ink-dim">Region</dt><dd className="text-ink">{data.region ?? ''}</dd>
        <dt className="text-ink-dim">Country</dt><dd className="text-ink">{data.country_code ?? ''}</dd>
      </dl>
    </section>
  );
}
