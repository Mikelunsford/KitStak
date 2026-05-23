// F-Wave9-AUDIT-V3-WAVE-D-01: invoice aging helper used by InvoicesListPage
// to render an Aging column. Pure function so it stays unit-testable
// without standing up TanStack Query plus jsdom; the list page calls it
// with `today` left to the default `new Date()` in production but injects
// a deterministic clock in tests.
//
// Brand: returns plain strings ("Paid", "12 days", ".", etc). No em-dash,
// no double-hyphen, no emoji. The placeholder for "no issue/due date" is
// "." which matches the rest of the SPA's no-em-dash convention (see
// dates.ts `formatDateMedium`).
//
// Math: pure day diff via UTC midnight to dodge DST. Negative diffs are
// returned verbatim ("3 days" when due in three days) so the operator
// sees a credit-side aging on draft/future-issue invoices instead of
// "-3 days".

const PAID_STATUSES = new Set<string>(['paid']);
const CANCELLED_STATUSES = new Set<string>(['cancelled']);

interface InvoiceAgingInput {
  status: string;
  issue_date: string | null;
  due_date: string | null;
}

/**
 * Compute the aging label for a single invoice row.
 *
 * Behavior:
 * - status === 'paid'       -> "Paid"
 * - status === 'cancelled'  -> "."  (no aging on a cancelled bill)
 * - has due_date            -> days since due_date (unpaid receivable)
 * - else has issue_date     -> days since issue_date (draft/awaiting send)
 * - else                    -> "."
 *
 * Day diff is computed in UTC to avoid DST gaps; invoices store dates as
 * YYYY-MM-DD strings already, so parsing them as `${iso}T00:00:00Z` is
 * sufficient.
 */
export function formatInvoiceAging(
  invoice: InvoiceAgingInput,
  now: Date = new Date(),
): string {
  if (PAID_STATUSES.has(invoice.status)) return 'Paid';
  if (CANCELLED_STATUSES.has(invoice.status)) return '.';

  const anchor = invoice.due_date ?? invoice.issue_date;
  if (!anchor) return '.';

  const days = diffDaysUtc(anchor, now);
  if (days === null) return '.';

  // Singular vs plural so "1 days" never ships.
  const unit = Math.abs(days) === 1 ? 'day' : 'days';
  return `${days} ${unit}`;
}

/**
 * Whole-day diff between an ISO YYYY-MM-DD date and a Date. Positive when
 * the iso anchor is in the past. Returns null when the input is not a
 * parseable YYYY-MM-DD so callers can fall back without throwing.
 */
function diffDaysUtc(isoDate: string, now: Date): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return null;
  const [, y, mo, d] = m;
  const anchorUtcMs = Date.UTC(Number(y), Number(mo) - 1, Number(d));
  const nowUtcMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((nowUtcMs - anchorUtcMs) / msPerDay);
}
