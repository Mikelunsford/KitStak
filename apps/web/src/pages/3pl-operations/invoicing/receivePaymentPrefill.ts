// F-Wave9-AUDIT-V3-WAVE-F-01: pure helpers for the inline Receive Payment
// modal's pre-fill logic. Extracted so the SPA unit tests (node-only, no
// jsdom) can lock the prefill contract without mounting the modal.

import { resolveInvoiceBalancePrefill } from '../payments/resolveInvoiceBalancePrefill';
import { todayIsoDate } from '@/lib/dates';

export interface ReceivePaymentModalDefaults {
  amountCents: number | null;
  receivedAt: string;
}

/**
 * Build the initial form state for the Receive Payment modal from an
 * invoice's outstanding balance.
 *
 *   - `amountCents` is the invoice's outstanding balance via
 *     `resolveInvoiceBalancePrefill` (returns `null` when the balance
 *     is zero / negative / unparseable so the field stays empty).
 *   - `receivedAt` defaults to today via `todayIsoDate` (matches the
 *     same default the standalone PaymentCreatePage applies).
 *
 * Accepts an optional `now` arg so unit tests can pin a deterministic
 * date.
 */
export function buildReceivePaymentDefaults(
  balanceCents: number | string | null | undefined,
  now: Date = new Date(),
): ReceivePaymentModalDefaults {
  return {
    amountCents: resolveInvoiceBalancePrefill(balanceCents ?? null),
    receivedAt: todayIsoDate(now),
  };
}

export interface ReceivePaymentPostBodies {
  payment: {
    customer_id?: string;
    amount_cents: string;
    currency_code: string;
    payment_method?: string;
    reference_number?: string;
    received_at?: string;
  };
  allocation: {
    allocations: Array<{ invoice_id: string; amount_cents: string }>;
  };
}

export interface ReceivePaymentFormState {
  amountCents: number | null;
  receivedAt: string;
  paymentMethod: string;
  referenceNumber: string;
}

/**
 * Translate the modal's form state into the two POST bodies the modal
 * fires (`POST /invoicing-api/payments` then
 * `POST /invoicing-api/payments/:id/apply`). Pure transformation so the
 * unit test pins the wire shape.
 */
export function buildReceivePaymentPostBodies(
  state: ReceivePaymentFormState,
  ctx: { invoiceId: string; customerId: string | null; currencyCode: string },
): ReceivePaymentPostBodies {
  const amountWire = String(state.amountCents ?? 0);
  const payment: ReceivePaymentPostBodies['payment'] = {
    amount_cents: amountWire,
    currency_code: ctx.currencyCode || 'USD',
  };
  if (ctx.customerId) payment.customer_id = ctx.customerId;
  if (state.paymentMethod) payment.payment_method = state.paymentMethod;
  if (state.referenceNumber) payment.reference_number = state.referenceNumber;
  if (state.receivedAt) payment.received_at = state.receivedAt;

  const allocation: ReceivePaymentPostBodies['allocation'] = {
    allocations: [{ invoice_id: ctx.invoiceId, amount_cents: amountWire }],
  };
  return { payment, allocation };
}
