import { useParams } from 'react-router-dom';

import { useVendor } from '@/lib/hooks/useVendors';

export function VendorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error } = useVendor(id);

  if (isLoading) return <p className="px-8 py-12 text-ink-dim">Loading.</p>;
  if (error || !data) return <p className="px-8 py-12 text-accent">Vendor not found.</p>;

  return (
    <section className="px-8 py-12 max-w-4xl mx-auto flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">{data.display_name}</h1>
      <dl className="grid grid-cols-2 gap-4 font-sans text-sm">
        <Row label="Vendor number" value={data.vendor_number ?? ''} />
        <Row label="Email" value={data.email ?? ''} />
        <Row label="Phone" value={data.phone ?? ''} />
        <Row label="Currency" value={data.default_currency_code} />
        <Row label="Payment terms" value={`${data.default_payment_terms_days} days`} />
        <Row label="Tax ID" value={data.tax_id ?? ''} />
        <Row label="Active" value={data.is_active ? 'Yes' : 'No'} />
      </dl>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-ink-dim">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </>
  );
}
