// F-Wave9-AUDIT-V3-WAVE-F-01: two-column form grid primitive.
//
// Long create pages (Invoice, PO, Receiving, Shipment) currently stack
// every field in a single tall column on wide viewports because they
// each render `<form className="flex flex-col gap-4">`. On a desktop
// monitor the operator scrolls past empty whitespace and the form's
// visual rhythm collapses. FormGrid replaces the flat flex column with
// a responsive grid that places fields side-by-side on wider viewports
// and collapses to one column on mobile.
//
//   - `columns={2}` (default): two columns at `md` and up; one column
//     below `md`. Mobile collapse is automatic via Tailwind's responsive
//     prefix; no manual breakpoint plumbing required.
//   - Each direct child is treated as one cell. Use `FormGrid.Full` to
//     span a child across the full row (notes / textareas / submit
//     button rows).
//
// Brand posture:
//   - Hand-rolled Tailwind. No grid library.
//   - No new top-level deps.
//   - Tokens (`gap-x-6 gap-y-4`) match the existing form spacing in
//     ReceivingOrderCreatePage / ShipmentCreatePage so the migration is
//     visually neutral on those pages should the operator want to roll
//     them onto FormGrid in a follow-up.

import type { ReactNode } from 'react';

export interface FormGridProps {
  /**
   * Column count at `md` and up. One on mobile. Defaults to `2`.
   *
   * Constrained to a small set so Tailwind's JIT generates the right
   * classes at build time (arbitrary `md:grid-cols-${n}` strings would
   * not be detected by the content scanner).
   */
  columns?: 1 | 2 | 3;
  className?: string;
  children: ReactNode;
}

const COLUMN_CLASS: Record<NonNullable<FormGridProps['columns']>, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 md:grid-cols-2',
  3: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
};

/**
 * Responsive form grid. Each direct child is one cell unless wrapped in
 * `<FormGrid.Full>`. Mobile collapses to a single column automatically.
 */
export function FormGrid({
  columns = 2,
  className = '',
  children,
}: FormGridProps): JSX.Element {
  return (
    <div className={`grid gap-x-6 gap-y-4 ${COLUMN_CLASS[columns]} ${className}`}>
      {children}
    </div>
  );
}

export interface FormGridFullProps {
  className?: string;
  children: ReactNode;
}

/**
 * Span a child across every column of the surrounding FormGrid. Use for
 * notes / textarea / submit-row blocks that should remain full-width
 * even when the rest of the form is in two-column mode.
 */
function FormGridFull({ className = '', children }: FormGridFullProps): JSX.Element {
  return <div className={`md:col-span-full ${className}`}>{children}</div>;
}

FormGrid.Full = FormGridFull;
