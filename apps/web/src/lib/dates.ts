// Date and date-string formatters used across the SPA.
//
// All formatters accept either a Date or an ISO-8601 string. Returns "." for
// null / undefined / invalid input so callers can drop the result inline
// without conditional rendering.

export function formatDateMedium(input: Date | string | null | undefined): string {
  if (input === null || input === undefined || input === '') return '.';
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return '.';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(d);
}

/**
 * Today as a YYYY-MM-DD string in the runtime's local timezone. Used to
 * default <input type="date"> fields on create forms (B3 of Wave B):
 * Invoice issue date and Payment received-at both default to today so
 * the operator does not have to retype the obvious common case.
 *
 * Accepts an optional Date arg for unit-test determinism; production
 * callers omit the arg and get `new Date()`.
 */
export function todayIsoDate(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Add N days (positive or negative) to an ISO date string and return
 * a YYYY-MM-DD string. Used to compute invoice due-date from issue-date
 * plus customer.default_payment_terms_days (B3 of Wave B).
 *
 * Returns null when the input is not a parseable ISO date so callers
 * can fall back without throwing in the render path.
 */
export function addDaysIso(isoDate: string, days: number): string | null {
  if (!isoDate) return null;
  // Parse YYYY-MM-DD as a local date to avoid TZ drift when an operator
  // in UTC-7 hits "+ 30 days" on an issue_date of 2026-05-22; new
  // Date("2026-05-22") is parsed as UTC midnight, which renders as
  // 2026-05-21 in PST.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return null;
  const [, y, mo, d] = m;
  const base = new Date(Number(y), Number(mo) - 1, Number(d));
  if (Number.isNaN(base.getTime())) return null;
  base.setDate(base.getDate() + days);
  return todayIsoDate(base);
}

export function formatDateShort(input: Date | string | null | undefined): string {
  if (input === null || input === undefined || input === '') return '.';
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return '.';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(d);
}
