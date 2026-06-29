// Display formatters for the Estimate Engine UI. Cents are integers from the
// engine; these only format for display (never feed math back).

import { formatCents } from '@/lib/money';

/** Whole-dollar display for section/summary totals, e.g. "$12,480". */
export function centsWhole(cents: number): string {
  return '$' + Math.round(cents / 100).toLocaleString('en-US');
}

/** Two-decimal display for per-unit and line figures, e.g. "$0.18". */
export function centsExact(cents: number): string {
  return formatCents(cents, 'USD');
}

/** Micros to a two-decimal-ish display (per-unit sub-cent rate), e.g. "$0.1806". */
export function microsDisplay(micros: number): string {
  return '$' + (micros / 1_000_000).toFixed(4).replace(/0+$/, '').replace(/\.$/, '.00');
}

export function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** today + n days, as an ISO date string (YYYY-MM-DD). */
export function addDays(iso: string, n: number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export const VALIDITY_DAYS = 30;
