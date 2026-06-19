// Disclosure. Hand-rolled collapsible (R-W14-READ-03). A labeled toggle button
// (aria-expanded, aria-controls) and a region revealed below it, with a
// lucide-react chevron that rotates on open. No Radix, no headless library, per
// the constitution's refused-dependency list.
//
// Split into a pure DisclosureView (no hooks, so it is callable directly and
// unit-testable by an element-tree walk, mirroring resolveTableView/DataTable)
// and a thin Disclosure wrapper that owns the open boolean and a stable region
// id. Presentational: the caller owns the revealed content.

import { useId, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

export interface DisclosureViewProps {
  /** Visible toggle label, also the region's accessible name. */
  label: string;
  /** Whether the region is open. */
  open: boolean;
  /** Toggle handler. */
  onToggle: () => void;
  /** Stable id linking the button (aria-controls) to the region. */
  regionId: string;
  /** Revealed content. */
  children: ReactNode;
}

/**
 * Pure, hook-free view. The region stays mounted and is hidden (not unmounted)
 * when closed so `aria-controls` always resolves and the toggle announces a
 * real target. `hidden` removes it from the accessibility tree and tab order.
 */
export function DisclosureView({
  label,
  open,
  onToggle,
  regionId,
  children,
}: DisclosureViewProps) {
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={regionId}
        className="inline-flex w-fit items-center gap-1.5 font-sans text-xs font-semibold uppercase tracking-wide text-ink-dim hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <ChevronRight
          aria-hidden="true"
          className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`}
        />
        {label}
      </button>
      <div
        id={regionId}
        role="region"
        aria-label={label}
        hidden={!open}
        data-testid="disclosure-region"
      >
        {children}
      </div>
    </div>
  );
}

export interface DisclosureProps {
  /** Visible toggle label, also the region's accessible name. */
  label: string;
  /** Revealed content. */
  children: ReactNode;
  /** Whether the region starts open. Defaults to closed. */
  defaultOpen?: boolean;
}

export function Disclosure({ label, children, defaultOpen = false }: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  const regionId = useId();
  return (
    <DisclosureView
      label={label}
      open={open}
      onToggle={() => setOpen((prev) => !prev)}
      regionId={regionId}
    >
      {children}
    </DisclosureView>
  );
}
