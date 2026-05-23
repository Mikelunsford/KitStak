// F-Wave9-AUDIT-V3-WAVE-F-01: pure helpers for the
// time_to_send_invoice PostHog event payload.
//
// The hook in useInvoices.ts fires the event from the SPA's send-invoice
// mutation. The payload construction is pure so the unit test can lock
// the shape without running the full mutation pipeline.

/**
 * Property shape for the time_to_send_invoice PostHog event. Declared
 * as a type alias with an index signature so it satisfies the
 * `AnalyticsProps = Record<string, AnalyticsPropValue>` contract on the
 * `track()` helper while still locking the documented property names
 * for the funnel dashboard.
 *
 * `seconds_to_send` is null when either timestamp is missing or
 * unparseable — PostHog treats null properties as "absent" rather than
 * as numeric zero, so the funnel dashboard does not get polluted with
 * bogus "0 seconds" entries.
 */
export type TimeToSendInvoiceProps = {
  invoice_id: string;
  created_at: string | null;
  sent_at: string | null;
  seconds_to_send: number | null;
  // Index signature to satisfy AnalyticsProps. All values stay scalar
  // (string / number / boolean / null) per the analytics canon.
  [key: string]: string | number | boolean | null;
};

/**
 * Compute the time-to-send PostHog event payload from an invoice's
 * created_at and the send response's sent_at. Both inputs can be null
 * or unparseable; in either case `seconds_to_send` returns null and the
 * funnel filter can drop the row.
 */
export function buildTimeToSendInvoiceProps(
  invoiceId: string,
  createdAt: string | null,
  sentAt: string | null,
): TimeToSendInvoiceProps {
  return {
    invoice_id: invoiceId,
    created_at: createdAt,
    sent_at: sentAt,
    seconds_to_send: computeSecondsBetween(createdAt, sentAt),
  };
}

function computeSecondsBetween(
  start: string | null,
  end: string | null,
): number | null {
  if (!start || !end) return null;
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return null;
  // Floor so "1.9s" becomes "1s" — PostHog buckets integers cleanly in
  // its funnel dashboard. Allow negative values through unchanged so a
  // clock-skew anomaly is visible in the data rather than masked.
  return Math.floor((endMs - startMs) / 1000);
}
