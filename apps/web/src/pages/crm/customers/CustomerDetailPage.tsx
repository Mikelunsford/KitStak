import { Link, useParams } from 'react-router-dom';

import { useCustomer } from '@/lib/hooks/useCustomer';

export function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const query = useCustomer(id);

  if (query.isLoading) {
    return <p className="px-8 py-10 font-sans text-ink-dim">Loading.</p>;
  }
  if (query.isError || !query.data) {
    return (
      <p className="px-8 py-10 font-sans text-accent">
        Customer not found.
      </p>
    );
  }
  const c = query.data;
  return (
    <section className="px-8 py-10 max-w-4xl mx-auto flex flex-col gap-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-4xl font-display tracking-wide text-ink">
          {c.display_name.toUpperCase()}
        </h1>
        <Link
          to={`/crm/customers/${c.id}/edit`}
          className="px-4 py-2 bg-bg-2 border border-line font-display tracking-wider"
        >
          EDIT
        </Link>
      </header>
      <dl className="grid grid-cols-2 gap-4 font-sans text-sm">
        <dt className="text-ink-dim">Kind</dt>
        <dd>{c.kind}</dd>
        <dt className="text-ink-dim">Status</dt>
        <dd>{c.status}</dd>
        <dt className="text-ink-dim">Email</dt>
        <dd>{c.primary_email ?? ''}</dd>
        <dt className="text-ink-dim">Phone</dt>
        <dd>{c.primary_phone ?? ''}</dd>
        <dt className="text-ink-dim">Tax id</dt>
        <dd>{c.tax_id ?? ''}</dd>
        <dt className="text-ink-dim">Default currency</dt>
        <dd>{c.default_currency_code ?? ''}</dd>
      </dl>
    </section>
  );
}
