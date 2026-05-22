import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { useVendorsList } from '@/lib/hooks/useVendors';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';

/**
 * VendorsListPage. Lists active vendors for the caller's org.
 *
 * Filterable by display_name, sortable by created_at. Pagination is cursor
 * based via TanStack Query. Capability gate `vendors.vendor.create` hides
 * the Create button when the role lacks it.
 */
export function VendorsListPage() {
  const { data, isLoading, error } = useVendorsList();
  const caps = useVioCapabilities();
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    const rows = data?.items ?? [];
    if (!filter.trim()) return rows;
    const needle = filter.toLowerCase();
    return rows.filter((r) => r.display_name.toLowerCase().includes(needle));
  }, [data, filter]);

  return (
    <section className="px-8 py-12 max-w-6xl mx-auto flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-display tracking-wide text-ink">VENDORS</h1>
        {caps.can('vendors.vendor.create') ? (
          <Link
            to="/3pl-operations/vendors/new"
            className="px-4 py-2 bg-accent text-on-primary font-sans text-sm"
          >
            New Vendor
          </Link>
        ) : null}
      </header>

      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter by name"
        className="border border-line bg-bg-2 px-3 py-2 text-ink font-sans text-sm"
      />

      {isLoading ? <p className="text-ink-dim">Loading.</p> : null}
      {error ? <p className="text-accent">Failed to load vendors.</p> : null}

      {!isLoading && !error && (data?.items?.length ?? 0) === 0 && !filter ? (
        <ListEmptyState
          entity="vendor"
          explainer="Vendors are the companies you buy materials from."
          addLabel="Add vendor"
          addTo="/3pl-operations/vendors/new"
          canAdd={caps.can('vendors.vendor.create')}
        />
      ) : (
      <table className="w-full border border-line text-sm font-sans">
        <thead className="bg-bg-2 text-left text-ink-dim">
          <tr>
            <th className="px-4 py-2">Name</th>
            <th className="px-4 py-2">Number</th>
            <th className="px-4 py-2">Currency</th>
            <th className="px-4 py-2">Terms</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((v) => (
            <tr key={v.id} className="border-t border-line">
              <td className="px-4 py-2">
                <Link to={`/3pl-operations/vendors/${v.id}`} className="text-ink underline">
                  {v.display_name}
                </Link>
              </td>
              <td className="px-4 py-2 text-ink-dim">{v.vendor_number ?? ''}</td>
              <td className="px-4 py-2 text-ink-dim">{v.default_currency_code}</td>
              <td className="px-4 py-2 text-ink-dim">{v.default_payment_terms_days}d</td>
            </tr>
          ))}
        </tbody>
      </table>
      )}
    </section>
  );
}
