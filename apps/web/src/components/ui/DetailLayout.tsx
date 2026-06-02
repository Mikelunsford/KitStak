// DetailLayout. Two-column scaffold for entity detail pages (F-Wave10-UI-KIT-01).
//
// Main work in the left column (children), supporting context in a right rail
// (status, key facts, activity). Stacks to a single column below the lg
// breakpoint. Presentational only; the page owns all data and handlers and
// passes rendered nodes.

import type { ReactNode } from 'react';

export interface DetailLayoutProps {
  /** Main column content (the primary work surface). */
  children: ReactNode;
  /** Right-rail content (status, key facts, activity). */
  rail: ReactNode;
}

export function DetailLayout({ children, rail }: DetailLayoutProps) {
  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <div
        className="flex min-w-0 flex-1 flex-col gap-6"
        data-testid="detail-main"
      >
        {children}
      </div>
      <aside
        className="flex w-full flex-col gap-6 lg:w-80 lg:shrink-0"
        data-testid="detail-rail"
      >
        {rail}
      </aside>
    </div>
  );
}
