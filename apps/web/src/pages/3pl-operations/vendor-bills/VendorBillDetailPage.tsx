// VendorBillDetailPage. Migration to the shared UI kit (F-Wave10-UI-KIT-01,
// 3PL CRUD tail): PageHeader + DetailLayout (HISTORY in the rail) replace the
// hand-rolled header and bottom-of-page history section. FSM transition
// buttons move to the kit Button (ghost for the destructive cancel, secondary
// for forward transitions) and humanise their target-state labels.
//
// Money fix: total / paid / balance and the per-payment amount now render
// through formatCents instead of raw String(*_cents) (constitution: never raw
// cents). FSM transitions, the cancel destructiveConfirm, the capability
// gates, the payments table, and the Record Payment form are preserved.

import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import { fallbackLabel } from '@/components/shell/breadcrumbFallback';
import { StateStepper } from '@/components/shell/StateStepper';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { PageHeader } from '@/components/ui/PageHeader';
import { DetailLayout } from '@/components/ui/DetailLayout';
import { humaniseStatus } from '@/components/ui/StatusBadge';
import {
  STATE_STEPPER_PATHS,
  isOffPath,
} from '@/lib/workflow/stateStepperPaths';
import {
  useVendorBill, useVendorBillPayments, useTransitionVendorBill,
  useCreateVendorBillPayment,
} from '@/lib/hooks/useVendorBills';
import { useVendor } from '@/lib/hooks/useVendors';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { VENDOR_BILL_FSM } from '@/lib/workflow/vendors_inventory_ops';
import type { VendorBillStatus } from '@/lib/types/vendors_inventory_ops';
import { formatCents } from '@/lib/money';
import { destructiveConfirm } from '@/lib/destructiveConfirm';

export function VendorBillDetailPage() {
  const { id } = useParams<{ id: string }>();
  const bill = useVendorBill(id);
  const payments = useVendorBillPayments(id);
  const transition = useTransitionVendorBill(id ?? '');
  const createPayment = useCreateVendorBillPayment(id ?? '');
  const caps = useVioCapabilities();

  // G-VB-DETAIL-01: resolve vendor display_name + link.
  const vendor = useVendor(bill.data?.vendor_id);

  // G-VB-DETAIL-02: record-payment form state.
  const [paymentDate, setPaymentDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [paymentAmountCents, setPaymentAmountCents] = useState('0');
  const [paymentCurrency, setPaymentCurrency] = useState('USD');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');

  if (bill.isLoading) return <p className="px-8 py-12 text-ink-dim">Loading.</p>;
  if (bill.error || !bill.data) {
    return <p className="px-8 py-12 text-accent">Bill not found.</p>;
  }
  const d = bill.data;
  const next = VENDOR_BILL_FSM.transitions
    .filter((t) => t.from === d.status)
    .map((t) => t.to);

  function onRecordPayment(e: FormEvent) {
    e.preventDefault();
    // F-Wave7-MUTATION-ERRORS-SWEEP-01: switch from await mutateAsync to
    // mutate(input, { onSuccess }) so a 4xx surfaces in the inline error
    // renderer rendered below instead of an unhandled rejection.
    createPayment.mutate(
      {
        payment_date: paymentDate,
        amount_cents: paymentAmountCents,
        currency_code: paymentCurrency,
        method: paymentMethod || null,
        reference: paymentReference || null,
        notes: paymentNotes || null,
      },
      {
        onSuccess: () => {
          setPaymentAmountCents('0');
          setPaymentMethod('');
          setPaymentReference('');
          setPaymentNotes('');
        },
      },
    );
  }

  const vendorLabel = vendor.data
    ? vendor.data.display_name
    : vendor.isLoading
      ? 'Loading.'
      : 'Unknown vendor';

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-6 px-8 py-12">
      <Breadcrumbs
        items={[
          { label: 'Vendors', to: '/purchasing/vendors' },
          {
            label: fallbackLabel(vendor.data?.display_name, d.vendor_id),
            to: `/purchasing/vendors/${d.vendor_id}`,
          },
          { label: 'Bills', to: '/purchasing/vendor-bills' },
          { label: d.bill_number ?? d.id.slice(0, 8) },
        ]}
      />
      {/* UX-Q7: display-only horizontal progress stepper. */}
      <StateStepper
        steps={[...STATE_STEPPER_PATHS.vendor_bill.path]}
        current={d.status}
        offPath={
          isOffPath('vendor_bill', d.status)
            ? {
                state: d.status,
                label: STATE_STEPPER_PATHS.vendor_bill.resolveLabel(d.status),
              }
            : undefined
        }
      />
      <PageHeader
        title={`Bill ${d.bill_number ?? d.id.slice(0, 8)}`}
        actions={
          <Link to={`/purchasing/vendor-bills/${d.id}/edit`}>
            <Button variant="secondary">Edit</Button>
          </Link>
        }
      />

      <DetailLayout
        rail={
          <section>
            <h2 className="mb-3 text-2xl font-display tracking-wide text-ink">
              HISTORY
            </h2>
            <AuditTimeline entityType="vendor_bill" entityId={id ?? null} />
          </section>
        }
      >
        {caps.can('vendor_bills.vendor_bill.transition') && next.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {next.map((to) => (
              <Button
                key={to}
                variant={to === 'cancelled' ? 'ghost' : 'secondary'}
                onClick={async () => {
                  // UX-Q8: cancelling reverses an AP obligation.
                  if (
                    to === 'cancelled' &&
                    !(await destructiveConfirm({
                      action: 'Cancel this vendor bill',
                      consequence:
                        'The bill will move to cancelled and the payable obligation will be reversed.',
                    }))
                  )
                    return;
                  transition.mutate(to as VendorBillStatus);
                }}
                disabled={transition.isPending}
              >
                {humaniseStatus(to)}
              </Button>
            ))}
          </div>
        ) : null}
        {transition.error && (
          <p className="font-sans text-sm text-accent">
            {transition.error instanceof Error
              ? transition.error.message
              : 'Transition failed.'}
          </p>
        )}
        <dl className="grid grid-cols-2 gap-4 font-sans text-sm">
          <dt className="text-ink-dim">Vendor</dt>
          <dd className="text-ink">
            <Link
              to={`/purchasing/vendors/${d.vendor_id}`}
              className="text-accent hover:underline"
            >
              {vendorLabel}
            </Link>
          </dd>
          <dt className="text-ink-dim">Bill date</dt>
          <dd className="text-ink">{d.bill_date}</dd>
          <dt className="text-ink-dim">Due</dt>
          <dd className="text-ink">{d.due_date ?? ''}</dd>
          <dt className="text-ink-dim">Total</dt>
          <dd className="tabular-nums text-ink">
            {formatCents(d.total_cents as number | string, d.currency_code)}
          </dd>
          <dt className="text-ink-dim">Paid</dt>
          <dd className="tabular-nums text-ink">
            {formatCents(d.paid_cents as number | string, d.currency_code)}
          </dd>
          <dt className="text-ink-dim">Balance</dt>
          <dd className="tabular-nums text-ink">
            {formatCents(d.balance_cents as number | string, d.currency_code)}
          </dd>
        </dl>

        <section>
          <h2 className="mb-3 text-2xl font-display tracking-wide text-ink">
            PAYMENTS
          </h2>
          <table className="w-full border border-line text-sm font-sans">
            <thead className="bg-bg-2 text-left text-ink-dim">
              <tr>
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2 text-right">Amount</th>
                <th className="px-4 py-2">Method</th>
                <th className="px-4 py-2">Reference</th>
              </tr>
            </thead>
            <tbody>
              {(payments.data ?? []).length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-3 text-ink-dim text-center">
                    No payments recorded.
                  </td>
                </tr>
              ) : (
                (payments.data ?? []).map((p) => (
                  <tr key={p.id} className="border-t border-line">
                    <td className="px-4 py-2 text-ink">{p.payment_date}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-dim">
                      {formatCents(
                        p.amount_cents as number | string,
                        p.currency_code,
                      )}
                    </td>
                    <td className="px-4 py-2 text-ink-dim">{p.method ?? ''}</td>
                    <td className="px-4 py-2 text-ink-dim">
                      {p.reference ?? ''}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>

        {caps.can('vendor_bills.payment.write') ? (
          <form
            onSubmit={onRecordPayment}
            className="flex flex-col gap-3 border border-line p-4"
          >
            <h3 className="font-display tracking-wider text-ink">
              RECORD PAYMENT
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <TextInput
                label="Payment date"
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                required
              />
              <TextInput
                label="Amount (cents)"
                value={paymentAmountCents}
                onChange={(e) => setPaymentAmountCents(e.target.value)}
                inputMode="numeric"
                required
              />
              <TextInput
                label="Currency"
                value={paymentCurrency}
                onChange={(e) => setPaymentCurrency(e.target.value.toUpperCase())}
                maxLength={3}
              />
              <TextInput
                label="Method"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                placeholder="ach, wire, card, check."
              />
              <TextInput
                label="Reference"
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
              />
            </div>
            <label className="flex flex-col gap-2">
              <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
                Notes
              </span>
              <textarea
                value={paymentNotes}
                onChange={(e) => setPaymentNotes(e.target.value)}
                rows={2}
                className="bg-bg-2 border border-line text-ink px-4 py-3 font-sans focus:outline-none focus:border-accent"
              />
            </label>
            {createPayment.error && (
              <p className="text-accent font-sans text-sm">
                {(createPayment.error as Error).message}
              </p>
            )}
            <Button type="submit" disabled={createPayment.isPending}>
              {createPayment.isPending ? 'Saving.' : 'Record payment'}
            </Button>
          </form>
        ) : null}
      </DetailLayout>
    </section>
  );
}
