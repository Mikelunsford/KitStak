import { Link } from 'react-router-dom';
import { EntityLabel } from '@/components/data/EntityLabel';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { useVendorBillsList } from '@/lib/hooks/useVendorBills';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { formatCents } from '@/lib/money';

export function VendorBillsListPage() {
  const { data, isLoading, error } = useVendorBillsList();
  const caps = useVioCapabilities();
  return (
    <section className="px-8 py-12 max-w-6xl mx-auto flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-display tracking-wide text-ink">VENDOR BILLS</h1>
        {caps.can('vendor_bills.vendor_bill.create') ? (
          <Link to="/3pl-operations/vendor-bills/new" className="px-4 py-2 bg-accent text-on-primary font-sans text-sm">New Bill</Link>
        ) : null}
      </header>
      {isLoading ? <p className="text-ink-dim">Loading.</p> : null}
      {error ? <p className="text-accent">Failed to load.</p> : null}
      {!isLoading && !error && (data ?? []).length === 0 ? (
        <ListEmptyState
          entity="vendor bill"
          explainer="Vendor bills are invoices from your vendors."
          addLabel="Add vendor bill"
          addTo="/3pl-operations/vendor-bills/new"
          canAdd={caps.can('vendor_bills.vendor_bill.create')}
        />
      ) : (
      <table className="w-full border border-line text-sm font-sans">
        <thead className="bg-bg-2 text-left text-ink-dim">
          <tr>
            <th className="px-4 py-2">Bill #</th>
            <th className="px-4 py-2">Vendor</th>
            <th className="px-4 py-2">Status</th>
            <th className="px-4 py-2">Total</th>
            <th className="px-4 py-2">Balance</th>
            <th className="px-4 py-2">Due</th>
          </tr>
        </thead>
        <tbody>
          {(data ?? []).map((b) => (
            <tr key={b.id} className="border-t border-line">
              <td className="px-4 py-2"><Link to={`/3pl-operations/vendor-bills/${b.id}`} className="text-ink underline">{b.bill_number ?? b.id.slice(0, 8)}</Link></td>
              <td className="px-4 py-2 text-ink-dim"><EntityLabel kind="vendor" id={b.vendor_id} /></td>
              <td className="px-4 py-2"><span className="inline-block px-2 py-0.5 border border-line text-xs font-mono uppercase text-ink-dim">{b.status}</span></td>
              <td className="px-4 py-2 text-ink-dim">{formatCents(b.total_cents as number | string, b.currency_code)}</td>
              <td className="px-4 py-2 text-ink-dim">{formatCents(b.balance_cents as number | string, b.currency_code)}</td>
              <td className="px-4 py-2 text-ink-dim">{b.due_date ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      )}
    </section>
  );
}
