// Select. Shared styled select (F-Wave10-UI-KIT-01). Standardizes the bordered
// select look that pages hand-rolled inline, and pairs with FilterBar. A plain
// wrapper over the native element so it stays accessible and dependency-free
// (no Radix, no headless lib, per the constitution). Pass an aria-label when
// the select has no visible <label>.

import type { SelectHTMLAttributes } from 'react';

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export function Select({ className = '', ...rest }: SelectProps) {
  const base =
    'bg-bg-2 border border-line text-ink px-3 py-2 font-sans text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50';
  return <select className={`${base} ${className}`} {...rest} />;
}
