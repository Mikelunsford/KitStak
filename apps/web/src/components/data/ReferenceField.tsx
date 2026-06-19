// ReferenceField. One labeled reference row for the Additional details
// disclosure on list rows (R-W14-READ-03) and detail headers (R-W14-READ-04).
//
// The reference number left the main list view; this renders it (and any
// secondary reference such as a converted project) under the disclosure. The
// value renders in tabular Inter Tight figures (tabular-nums), not mono, per
// the number-legibility decision (R-W14-READ-01). Renders nothing when the
// value is empty so a page can pass optional references without guarding.

import type { ReactNode } from 'react';

export interface ReferenceFieldProps {
  /** Short field label, e.g. "Number" or "Project". */
  label: string;
  /** The reference value. Null, undefined, or empty string renders nothing. */
  value: ReactNode;
}

/** True when a reference value is worth rendering. Pure, for unit tests. */
export function hasReferenceValue(value: ReactNode): boolean {
  return value !== null && value !== undefined && value !== '';
}

export function ReferenceField({ label, value }: ReferenceFieldProps) {
  if (!hasReferenceValue(value)) return null;
  return (
    <div className="flex gap-2">
      <span className="font-mono text-xs uppercase tracking-wide text-ink-dim">
        {label}
      </span>
      <span className="tabular-nums text-ink">{value}</span>
    </div>
  );
}
