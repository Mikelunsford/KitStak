import { RelativeTime } from 'kitstak-ui';

// Note: output is computed relative to the current date at render time, so the
// exact label varies. These ISO values are spread across recent and older
// instants to exercise the second / hour / day / month / year buckets.

export function MinutesAgo() {
  return <RelativeTime value="2026-06-24T08:45:00Z" />;
}

export function DaysAgo() {
  return <RelativeTime value="2026-06-20T14:30:00Z" />;
}

export function MonthsAgo() {
  return <RelativeTime value="2026-03-01T09:00:00Z" />;
}

export function OverAYear() {
  return <RelativeTime value="2024-11-15T09:00:00Z" />;
}

export function Empty() {
  return <RelativeTime value={null} />;
}
