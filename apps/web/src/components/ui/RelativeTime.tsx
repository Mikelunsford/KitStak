// F-Wave9-AUDIT-V3-WAVE-F-01: shared relative-time renderer.
//
// Renders an ISO-8601 timestamp as a relative label ("2 hours ago",
// "3 days ago"). Uses native `Intl.RelativeTimeFormat`; the constitution
// bans dayjs / date-fns / moment via ESLint `no-restricted-imports`.
//
// The pure label computation lives in `formatRelativeLabel` so it can be
// unit-tested without React or a DOM environment (the SPA test suite is
// node-only — no jsdom). The component itself is a thin wrapper that
// renders the label inside the caller's choice of element and exposes
// the absolute ISO timestamp via `title=` so a hover reveals the precise
// instant for accessibility.

import { createElement, type ReactElement } from 'react';

/**
 * Granularity buckets the formatter picks between. Capped at "year" — for
 * anything older we fall back to an absolute medium date so the operator
 * is not chasing an unintuitive "27 months ago".
 */
const MINUTE = 60;
const HOUR = 60 * 60;
const DAY = 60 * 60 * 24;
const WEEK = DAY * 7;
// Month / year are coarse buckets; we use 30 days and 365 days so the
// label is deterministic regardless of which month the reference date
// lands in. The component's title attribute carries the absolute ISO
// timestamp so the precise instant is always recoverable.
const MONTH = DAY * 30;
const YEAR = DAY * 365;

/**
 * Compute a relative-time label for `iso` relative to `now`. Pure
 * function so the unit tests do not need a DOM environment.
 *
 *   - `null` / `undefined` / empty input returns `''` (caller can drop
 *     the result inline without conditional rendering).
 *   - Invalid ISO returns `''` for the same reason; the constitution
 *     forbids throwing in render-path helpers.
 *   - Future timestamps render as "in N <unit>" via the same
 *     `Intl.RelativeTimeFormat` so the caller does not have to special
 *     case the sign.
 *   - Anything older than ~1 year falls back to an absolute medium-date
 *     string so the operator is not chasing an unintuitive
 *     "27 months ago".
 *
 * Accepts an optional `now` arg for unit-test determinism; production
 * callers omit it and get `new Date()`.
 */
export function formatRelativeLabel(
  iso: string | null | undefined,
  now: Date = new Date(),
): string {
  if (iso === null || iso === undefined || iso === '') return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';

  const diffSec = Math.round((then - now.getTime()) / 1000);
  const absSec = Math.abs(diffSec);

  // Anything beyond ~1 year falls back to an absolute medium date.
  // The component still carries the ISO in title= so the operator can
  // recover the precise instant on hover.
  if (absSec >= YEAR) {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(new Date(then));
  }

  const rtf = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });

  if (absSec < MINUTE) {
    return rtf.format(diffSec, 'second');
  }
  if (absSec < HOUR) {
    return rtf.format(Math.round(diffSec / MINUTE), 'minute');
  }
  if (absSec < DAY) {
    return rtf.format(Math.round(diffSec / HOUR), 'hour');
  }
  if (absSec < WEEK) {
    return rtf.format(Math.round(diffSec / DAY), 'day');
  }
  if (absSec < MONTH) {
    return rtf.format(Math.round(diffSec / WEEK), 'week');
  }
  // < 1 year: render in months. The MONTH constant is 30 days so this
  // never produces a "13 months ago" — the YEAR cap above eats that.
  return rtf.format(Math.round(diffSec / MONTH), 'month');
}

export interface RelativeTimeProps {
  /**
   * ISO-8601 timestamp to render. `null` / `undefined` / empty render
   * the empty string so callers can drop the component inline without a
   * conditional.
   */
  value: string | null | undefined;
  /**
   * Element to render as. Defaults to `<span>`. Use `'time'` if the
   * surrounding context expects a semantic `<time>` element.
   */
  as?: 'span' | 'time';
  /**
   * Optional className passed through to the rendered element.
   */
  className?: string;
}

/**
 * RelativeTime. Renders an ISO timestamp as a relative label.
 *
 * The component reads the label from `formatRelativeLabel(value)` at
 * render time. There is no internal timer or tick — the component
 * re-computes only when the parent re-renders. This is acceptable for
 * the audit-timeline / list-row use case where the parent is already
 * re-rendering on the operator's normal interactions; we do not need
 * second-by-second precision on a hours-or-days-old timestamp.
 *
 * The absolute ISO timestamp is exposed via `title=` so a hover reveals
 * the precise instant (accessibility: screen readers announce the title
 * attribute alongside the visible text).
 *
 * When the `as` prop is `'time'`, the rendered `<time>` element also
 * carries a `dateTime=` attribute per HTML semantics.
 */
export function RelativeTime({
  value,
  as = 'span',
  className,
}: RelativeTimeProps): ReactElement {
  const label = formatRelativeLabel(value);
  const titleIso = value ?? undefined;
  const props: Record<string, unknown> = {
    title: titleIso,
    className,
  };
  if (as === 'time' && titleIso) {
    props.dateTime = titleIso;
  }
  return createElement(as, props, label);
}
