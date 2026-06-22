// Breadcrumbs. RETIRED (operator request, nav de-noise).
//
// The parent-chain trail was removed as noisy navigation chrome, in the same
// pass that dropped the page eyebrow and flattened the sidebar. Up-navigation is
// now the global Back button in AppShell, and DetailHeader carries the related
// links (project, source quote, template) for cross-record jumps.
//
// The component is kept as a no-op so the detail pages that still pass `items`
// compile unchanged; the dead calls (and their item-building) can be swept in a
// follow-up. Rendering nothing also resolves the customer-id flash on the quote
// detail breadcrumb (the id no longer briefly shows before the name resolves,
// because nothing renders at all).

export interface BreadcrumbItem {
  /** Display label. Resolved human-readable name, not a UUID. */
  label: string;
  /** Optional href for ancestor items. */
  to?: string;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
}

export function Breadcrumbs(_props: BreadcrumbsProps): null {
  return null;
}
