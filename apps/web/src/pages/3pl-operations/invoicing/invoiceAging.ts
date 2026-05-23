// F-Wave9-SMOKE-2026-05-23-02: humanize the Aging column on the invoices
// list. Operator smoke flagged the prior copy ("-30 days") as misleading
// since negative-day strings read as "past due" to operators. This helper
// now returns one of seven operator-facing copy strings.
//
// Mapping (state + days-from-due):
//   paid                                  -> "Paid"
//   cancelled                             -> "."
//   draft                                 -> "."
//   sent/unpaid, past due  (today > due)  -> "N days late" (singular "1 day late")
//   sent/unpaid, due today (today == due) -> "Due today"
//   sent/unpaid, not yet due (today<due)  -> "Due in N days" (singular "Due in 1 day")
//   sent/unpaid, no due_date              -> "."
//
// Brand: NO em-dash, NO double-hyphen, NO emoji. Inert cells render "."
// (period). The list page renders the returned string verbatim.
//
// Math: pure day diff via UTC midnight to dodge DST. Invoices store dates
// as YYYY-MM-DD strings, so parsing as `${iso}T00:00:00Z` is sufficient.

const PAID_STATUSES = new Set<string>(['paid']);
const CANCELLED_STATUSES = new Set<string>(['cancelled']);
const DRAFT_STATUSES = new Set<string>(['draft']);

interface InvoiceAgingInput {
  status: string;
  issue_date: string | null;
  due_date: string | null;
}

/**
 * Compute the operator-facing aging label for a single invoice row.
 *
 * Returns one of:
 *  - "Paid"
 *  - "."                  (cancelled, draft, no due_date, unparseable date)
 *  - "Due today"          (today == due_date)
 *  - "Due in N days"      (today < due_date; "Due in 1 day" at the singular)
 *  - "N days late"        (today > due_date; "1 day late" at the singular)
 */
export function formatInvoiceAging(
  invoice: InvoiceAgingInput | null | undefined,
  now: Date = new Date(),
): string {
  if (!invoice) return '.';
  if (PAID_STATUSES.has(invoice.status)) return 'Paid';
  if (CANCELLED_STATUSES.has(invoice.status)) return '.';
  if (DRAFT_STATUSES.has(invoice.status)) return '.';

  // sent / unpaid / partially_paid / overdue / anything else with a balance:
  // we need a due_date to say anything useful. No due_date => inert.
  if (!invoice.due_date) return '.';

  const days = diffDaysUtc(invoice.due_date, now);
  if (days === null) return '.';

  // days > 0 => past due (today is days past the due_date)
  // days === 0 => due today
  // days < 0  => not yet due (due in |days| days)
  if (days === 0) return 'Due today';
  if (days > 0) {
    const unit = days === 1 ? 'day' : 'days';
    return `${days} ${unit} late`;
  }
  const ahead = -days;
  const unit = ahead === 1 ? 'day' : 'days';
  return `Due in ${ahead} ${unit}`;
}

/**
 * Whole-day diff between an ISO YYYY-MM-DD date and a Date. Positive when
 * the iso anchor is in the past (i.e. invoice is past due). Returns null
 * when the input is not a parseable YYYY-MM-DD so callers can fall back
 * without throwing.
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
