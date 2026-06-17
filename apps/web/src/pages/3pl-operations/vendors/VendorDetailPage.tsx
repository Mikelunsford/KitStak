import { Link, useParams } from 'react-router-dom';
import { CreditCard, PackageOpen, Receipt, ReceiptText } from 'lucide-react';

import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import { RelatedSection } from '@/components/shell/RelatedSection';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Tabs, type TabSpec } from '@/components/ui/Tabs';
import { useVendor } from '@/lib/hooks/useVendors';
import { usePurchaseOrdersList } from '@/lib/hooks/usePurchaseOrders';
import { useVendorBillsList } from '@/lib/hooks/useVendorBills';
import { useExpensesList } from '@/lib/hooks/useExpenses';
import { useReceivingOrdersList } from '@/lib/hooks/useOps';

/**
 * VendorDetailPage. Closes G-VEND-DETAIL-01. The vendor record is the chain hub:
 * an Overview tab plus one tab per related record set (purchase orders, vendor
 * bills, expenses, receiving), each with a "New X" CTA that lands on the matching
 * create form with vendor_id prefilled. F-UIUX-HUB-TABS-ROLLOUT-01 moved the
 * sections into the shared Tabs primitive (matching the customer hub) and onto
 * the shared RelatedSection, so the long single-column page reads as a hub.
 *
 * F-Wave7-LISTFILTER-01: vendor_id FK filter lifted into the SQL layer for
 * purchase_orders, vendor_bills, expenses, and receiving_orders. Bandwidth bound
 * to single-vendor rows, paginated lists no longer miss children beyond the
 * first page, and RLS Pattern A still 200 + []s a cross-tenant vendor_id at the
 * org gate.
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

  const tabs: TabSpec[] = [
    {
      key: 'overview',
      label: 'Overview',
      panel: (
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
          <dt className="text-ink-dim">Active</dt>
          <dd className="text-ink">
            <StatusBadge status={data.is_active ? 'active' : 'inactive'} />
          </dd>
        </dl>
      ),
    },
    {
      key: 'purchase-orders',
      label: 'Purchase orders',
      panel: (
        <RelatedSection
          title="PURCHASE ORDERS"
          entity="purchase order"
          ctaLabel="New PO"
          ctaHref={`/purchasing/purchase-orders/new?vendor_id=${vendorId}`}
          isLoading={purchaseOrders.isLoading}
          emptyExplainer="Purchase orders commit spend with this vendor. Raise one to order goods or services."
          emptyIcon={Receipt}
          count={relatedPOs.length}
        >
          {relatedPOs.map((po) => (
            <li
              key={po.id}
              className="border border-line bg-bg-2 px-3 py-2 text-sm font-sans"
            >
              <Link
                to={`/purchasing/purchase-orders/${po.id}`}
                className="underline"
              >
                {po.po_number ?? po.id.slice(0, 8)}
              </Link>
              <span className="ml-2 inline-flex">
                <StatusBadge status={po.status} />
              </span>
            </li>
          ))}
        </RelatedSection>
      ),
    },
    {
      key: 'vendor-bills',
      label: 'Vendor bills',
      panel: (
        <RelatedSection
          title="VENDOR BILLS"
          entity="vendor bill"
          ctaLabel="New bill"
          ctaHref={`/purchasing/vendor-bills/new?vendor_id=${vendorId}`}
          isLoading={vendorBills.isLoading}
          emptyExplainer="Vendor bills record what this vendor invoices you. Enter one to track and pay it."
          emptyIcon={ReceiptText}
          count={relatedBills.length}
        >
          {relatedBills.map((b) => (
            <li
              key={b.id}
              className="border border-line bg-bg-2 px-3 py-2 text-sm font-sans"
            >
              <Link
                to={`/purchasing/vendor-bills/${b.id}`}
                className="underline"
              >
                {b.bill_number ?? b.id.slice(0, 8)}
              </Link>
              <span className="ml-2 inline-flex">
                <StatusBadge status={b.status} />
              </span>
            </li>
          ))}
        </RelatedSection>
      ),
    },
    {
      key: 'expenses',
      label: 'Expenses',
      panel: (
        <RelatedSection
          title="EXPENSES"
          entity="expense"
          ctaLabel="New expense"
          ctaHref={`/purchasing/expenses/new?vendor_id=${vendorId}`}
          isLoading={expenses.isLoading}
          emptyExplainer="Expenses capture ad-hoc costs paid to this vendor outside a purchase order."
          emptyIcon={CreditCard}
          count={relatedExpenses.length}
        >
          {relatedExpenses.map((e) => (
            <li
              key={e.id}
              className="border border-line bg-bg-2 px-3 py-2 text-sm font-sans"
            >
              <Link to={`/purchasing/expenses/${e.id}`} className="underline">
                {e.expense_number ?? e.id.slice(0, 8)}
              </Link>
              <span className="ml-2 inline-flex">
                <StatusBadge status={e.status} />
              </span>
            </li>
          ))}
        </RelatedSection>
      ),
    },
    {
      key: 'receiving',
      label: 'Receiving',
      panel: (
        <RelatedSection
          title="RECEIVING ORDERS"
          entity="receiving order"
          ctaLabel="New receiving"
          ctaHref={`/3pl-operations/receiving/new?vendor_id=${vendorId}`}
          isLoading={receivingOrders.isLoading}
          emptyExplainer="Receiving orders log stock arriving from this vendor against a purchase order."
          emptyIcon={PackageOpen}
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
              <span className="ml-2 inline-flex">
                <StatusBadge status={r.status} />
              </span>
            </li>
          ))}
        </RelatedSection>
      ),
    },
  ];

  return (
    <section className="px-8 py-12 max-w-4xl mx-auto flex flex-col gap-8">
      <Breadcrumbs
        items={[
          { label: 'Vendors', to: '/purchasing/vendors' },
          { label: data.display_name },
        ]}
      />
      <PageHeader
        eyebrow="Purchasing / Vendors"
        title={data.display_name}
        actions={
          <Link to={`/purchasing/vendors/${data.id}/edit`}>
            <Button variant="secondary">Edit</Button>
          </Link>
        }
      />
      <Tabs aria-label="Vendor detail" tabs={tabs} />
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
