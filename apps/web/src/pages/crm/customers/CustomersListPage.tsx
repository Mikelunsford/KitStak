import { useState } from 'react';
import { Link } from 'react-router-dom';

import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { useCustomers } from '@/lib/hooks/useCustomers';

/**
 * Customers list. Search by display_name; filter by status. Per the
 * constitution, hand-rolled primitives plus Tailwind; no antd / radix.
 */
export function CustomersListPage() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const filters = {
    ...(q ? { q } : {}),
    ...(status ? { status } : {}),
  };
  const query = useCustomers(filters);

  return (
    <section className="px-8 py-10 max-w-6xl mx-auto flex flex-col gap-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-4xl font-display tracking-wide text-ink">
          CUSTOMERS
        </h1>
        <Link
          to="/crm/customers/new"
          className="px-4 py-2 bg-accent text-on-primary font-display tracking-wider"
        >
          NEW CUSTOMER
        </Link>
      </header>

      <div className="flex gap-3">
        <input
          type="text"
          placeholder="Search by name"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="flex-1 bg-bg-2 border border-line px-3 py-2 font-sans"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="bg-bg-2 border border-line px-3 py-2 font-sans"
        >
          <option value="">All statuses</option>
          <option value="new">New</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {query.isLoading ? (
        <p className="font-sans text-ink-dim">Loading.</p>
      ) : query.isError ? (
        <p className="font-sans text-accent">
          Failed to load customers.{' '}
          {query.error instanceof Error ? query.error.message : ''}
        </p>
      ) : (query.data?.length ?? 0) === 0 && !q && !status ? (
        <ListEmptyState
          entity="customer"
          explainer="Customers are the businesses you sell to. Add one to start a quote."
          addLabel="Add customer"
          addTo="/crm/customers/new"
        />
      ) : (
        <table className="w-full border border-line">
          <thead className="bg-bg-2 text-left font-display tracking-wider text-sm">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Kind</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Email</th>
            </tr>
          </thead>
          <tbody>
            {(query.data ?? []).map((c) => (
              <tr key={c.id} className="border-t border-line hover:bg-bg-2">
                <td className="px-4 py-2 font-sans">
                  <Link to={`/crm/customers/${c.id}`} className="underline">
                    {c.display_name}
                  </Link>
                </td>
                <td className="px-4 py-2 font-sans">{c.kind}</td>
                <td className="px-4 py-2 font-sans">{c.status}</td>
                <td className="px-4 py-2 font-sans">{c.primary_email ?? ''}</td>
              </tr>
            ))}
            {query.data && query.data.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center font-sans text-ink-dim">
                  No customers match.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      )}
    </section>
  );
}
