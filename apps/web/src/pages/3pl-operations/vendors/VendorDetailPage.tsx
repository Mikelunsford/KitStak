import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import { useVendor } from '@/lib/hooks/useVendors';
import { usePurchaseOrdersList } from '@/lib/hooks/usePurchaseOrders';
import { useVendorBillsList } from '@/lib/hooks/useVendorBills';
import { useExpensesList } from '@/lib/hooks/useExpenses';
import { useReceivingOrdersList } from '@/lib/hooks/useOps';

/**
 * VendorDetailPage. Closes G-VEND-DETAIL-01. Mirrors the customer-hub
 * pattern: the vendor record is the chain hub, so each related section
 * lists records that reference this vendor plus a "New X" CTA that lands
 * on the matching create form with vendor_id prefilled via the query
 * string.
 *
 * F-Wave7-LISTFILTER-01: vendor_id FK filter lifted into the SQL layer
 * for purchase_orders, vendor_bills, expenses, and receiving_orders.
 * Bandwidth bound to single-vendor rows, paginated lists no longer miss
 * children beyond the first page, and RLS Pattern A still 200 + []s a
 * cross-tenant vendor_id at the org gate.
 */
export function VendorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error } = useVendor(id);

  const purchaseOrders = usePurchaseOrdersList(id ? { vendor_id: id } : {});
  const vendorBills = useVendorBillsList(id ? { vendor_id: id } : {});
  const expenses = useExpensesList(id ? { vendor_id: id } : {});
  const receivingOrders = useReceivingOrdersList(id ? { vendor_id: id } : {});

  if (isLoading) return <p className="px-8 py-12 text-ink-dim">Loading.</p>;
  if (error || !data)
    return <p className="px-8 py-12 text-accent">Vendor not found.</p>;

  const vendorId = data.id;
  // F-Wave7-LISTFILTER-01: server-side vendor_id filter; no client-side
  // .filter(...) over the full org list.
  const relatedPOs = purchaseOrders.data ?? [];
  const relatedBills = vendorBills.data ?? [];
  const relatedExpenses = expenses.data ?? [];
  const relatedReceiving = receivingOrders.data ?? [];

  return (
    <section className="px-8 py-12 max-w-4xl mx-auto flex flex-col gap-8">
      <Breadcrumbs
        items={[
          { label: 'Vendors', to: '/3pl-operations/vendors' },
          { label: data.display_name },
        ]}
      />
      <h1 className="text-4xl font-display tracking-wide text-ink">
        {data.display_name}
      </h1>
      <dl className="grid grid-cols-2 gap-4 font-sans text-sm">
        <Row label="Vendor number" value={data.vendor_number ?? ''} />
        <Row label="Email" value={data.email ?? ''} />
        <Row label="Phone" value={data.phone ?? ''} />
        <Row label="Currency" value={data.default_currency_code} />
        <Row
          label="Payment terms"
          value={`${data.default_payment_terms_days} days`}
        />
        <Row label="Tax ID" value={data.tax_id ?? ''} />
        <Row label="Active" value={data.is_active ? 'Yes' : 'No'} />
      </dl>

      <RelatedSection
        title="PURCHASE ORDERS"
        ctaLabel="New PO"
        ctaHref={`/3pl-operations/purchase-orders/new?vendor_id=${vendorId}`}
        isLoading={purchaseOrders.isLoading}
        emptyMessage="No purchase orders for this vendor."
        count={relatedPOs.length}
      >
        {relatedPOs.map((po) => (
          <li
            key={po.id}
            className="border border-line bg-bg-2 px-3 py-2 text-sm font-sans"
          >
            <Link
              to={`/3pl-operations/purchase-orders/${po.id}`}
              className="underline"
            >
              {po.po_number ?? po.id.slice(0, 8)}
            </Link>
            <span className="text-ink-dim ml-2 text-xs font-mono">
              {po.status}
            </span>
          </li>
        ))}
      </RelatedSection>

      <RelatedSection
        title="VENDOR BILLS"
        ctaLabel="New bill"
        ctaHref={`/3pl-operations/vendor-bills/new?vendor_id=${vendorId}`}
        isLoading={vendorBills.isLoading}
        emptyMessage="No vendor bills for this vendor."
        count={relatedBills.length}
      >
        {relatedBills.map((b) => (
          <li
            key={b.id}
            className="border border-line bg-bg-2 px-3 py-2 text-sm font-sans"
          >
            <Link
              to={`/3pl-operations/vendor-bills/${b.id}`}
              className="underline"
            >
              {b.bill_number ?? b.id.slice(0, 8)}
            </Link>
            <span className="text-ink-dim ml-2 text-xs font-mono">
              {b.status}
            </span>
          </li>
        ))}
      </RelatedSection>

      <RelatedSection
        title="EXPENSES"
        ctaLabel="New expense"
        ctaHref={`/3pl-operations/expenses/new?vendor_id=${vendorId}`}
        isLoading={expenses.isLoading}
        emptyMessage="No expenses for this vendor."
        count={relatedExpenses.length}
      >
        {relatedExpenses.map((e) => (
          <li
            key={e.id}
            className="border border-line bg-bg-2 px-3 py-2 text-sm font-sans"
          >
            <Link
              to={`/3pl-operations/expenses/${e.id}`}
              className="underline"
            >
              {e.expense_number ?? e.id.slice(0, 8)}
            </Link>
            <span className="text-ink-dim ml-2 text-xs font-mono">
              {e.status}
            </span>
          </li>
        ))}
      </RelatedSection>

      <RelatedSection
        title="RECEIVING ORDERS"
        ctaLabel="New receiving"
        ctaHref={`/3pl-operations/receiving/new?vendor_id=${vendorId}`}
        isLoading={receivingOrders.isLoading}
        emptyMessage="No receiving orders for this vendor."
        count={relatedReceiving.length}
      >
        {relatedReceiving.map((r) => (
          <li
            key={r.id}
            className="border border-line bg-bg-2 px-3 py-2 text-sm font-sans"
          >
            <Link
              to={`/3pl-operations/receiving/${r.id}`}
              className="underline"
            >
              {r.receiving_number ?? r.id.slice(0, 8)}
            </Link>
            <span className="text-ink-dim ml-2 text-xs font-mono">
              {r.status}
            </span>
          </li>
        ))}
      </RelatedSection>
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

interface RelatedSectionProps {
  title: string;
  ctaLabel: string;
  ctaHref: string;
  isLoading: boolean;
  emptyMessage: string;
  count: number;
  children: ReactNode;
}

function RelatedSection({
  title,
  ctaLabel,
  ctaHref,
  isLoading,
  emptyMessage,
  count,
  children,
}: RelatedSectionProps) {
  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-display tracking-wide text-ink">{title}</h2>
        <Link
          to={ctaHref}
          className="px-3 py-1 bg-bg-2 border border-line font-display tracking-wider text-xs"
        >
          {ctaLabel.toUpperCase()}
        </Link>
      </header>
      {isLoading ? (
        <p className="font-sans text-sm text-ink-dim">Loading.</p>
      ) : count > 0 ? (
        <ul className="flex flex-col gap-1">{children}</ul>
      ) : (
        <p className="font-sans text-sm text-ink-dim">{emptyMessage}</p>
      )}
    </section>
  );
}
