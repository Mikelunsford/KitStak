import { useParams } from 'react-router-dom';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import {
  useVendorBill, useVendorBillPayments, useTransitionVendorBill,
} from '@/lib/hooks/useVendorBills';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { VENDOR_BILL_FSM } from '@/lib/workflow/vendors_inventory_ops';
import type { VendorBillStatus } from '@/lib/types/vendors_inventory_ops';

export function VendorBillDetailPage() {
  const { id } = useParams<{ id: string }>();
  const bill = useVendorBill(id);
  const payments = useVendorBillPayments(id);
  const transition = useTransitionVendorBill(id ?? '');
  const caps = useVioCapabilities();

  if (bill.isLoading) return <p className="px-8 py-12 text-ink-dim">Loading.</p>;
  if (bill.error || !bill.data) return <p className="px-8 py-12 text-accent">Bill not found.</p>;
  const d = bill.data;
  const next = VENDOR_BILL_FSM.transitions.filter((t) => t.from === d.status).map((t) => t.to);
  return (
    <section className="px-8 py-12 max-w-5xl mx-auto flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-4xl font-display tracking-wide text-ink">BILL {d.bill_number ?? d.id.slice(0, 8)}</h1>
        <span className="px-2 py-0.5 border border-line text-xs font-mono uppercase text-ink-dim">{d.status}</span>
      </header>
      {caps.can('vendor_bills.vendor_bill.transition') && next.length > 0 ? (
        <div className="flex gap-2">
          {next.map((to) => (
            <button key={to} onClick={() => transition.mutate(to as VendorBillStatus)} disabled={transition.isPending}
              className="px-3 py-1 border border-line font-sans text-xs uppercase text-ink hover:bg-bg-2">
              {to.replace('_', ' ')}
            </button>
          ))}
        </div>
      ) : null}
      <dl className="grid grid-cols-2 gap-4 font-sans text-sm">
        <dt className="text-ink-dim">Vendor</dt><dd className="text-ink">{d.vendor_id}</dd>
        <dt className="text-ink-dim">Bill date</dt><dd className="text-ink">{d.bill_date}</dd>
        <dt className="text-ink-dim">Due</dt><dd className="text-ink">{d.due_date ?? ''}</dd>
        <dt className="text-ink-dim">Total</dt><dd className="text-ink">{String(d.total_cents)}</dd>
        <dt className="text-ink-dim">Paid</dt><dd className="text-ink">{String(d.paid_cents)}</dd>
        <dt className="text-ink-dim">Balance</dt><dd className="text-ink">{String(d.balance_cents)}</dd>
      </dl>
      <h2 className="text-2xl font-display tracking-wide text-ink">PAYMENTS</h2>
      <table className="w-full border border-line text-sm font-sans">
        <thead className="bg-bg-2 text-left text-ink-dim">
          <tr><th className="px-4 py-2">Date</th><th className="px-4 py-2">Amount</th><th className="px-4 py-2">Method</th><th className="px-4 py-2">Reference</th></tr>
        </thead>
        <tbody>
          {(payments.data ?? []).map((p) => (
            <tr key={p.id} className="border-t border-line">
              <td className="px-4 py-2 text-ink">{p.payment_date}</td>
              <td className="px-4 py-2 text-ink-dim">{String(p.amount_cents)}</td>
              <td className="px-4 py-2 text-ink-dim">{p.method ?? ''}</td>
              <td className="px-4 py-2 text-ink-dim">{p.reference ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="mt-6">
        <h2 className="text-2xl font-display tracking-wide text-ink mb-3">HISTORY</h2>
        <AuditTimeline entityType="vendor_bill" entityId={id ?? null} />
      </section>
    </section>
  );
}
