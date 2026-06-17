// Shared related-records section for hub detail pages (F-UIUX-HUB-TABS-ROLLOUT-01).
//
// Extracted from CustomerDetailPage (#306) so every hub (customer, vendor, and
// the rest as they roll out) renders its related lists the same way: a titled
// section with a quick-create CTA, a loading state, the list of children, and a
// coaching empty state that leads with the same create action. Lifting this out
// of CustomerDetailPage removes the near-duplicate copy that VendorDetailPage
// carried and gives later hubs one primitive to reuse.

import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { DetailSectionEmptyCoaching } from './DetailSectionEmptyCoaching';

export interface RelatedSectionProps {
  title: string;
  /** Singular entity noun for the coaching surface, e.g. "quote". */
  entity: string;
  ctaLabel: string;
  ctaHref: string;
  isLoading: boolean;
  /**
   * Sentence-cased explainer rendered by DetailSectionEmptyCoaching when the
   * related list is empty. Should answer "what is this section for?". Authored
   * per-section by the caller so each list carries the right operator-readable
   * context.
   */
  emptyExplainer: string;
  /** Optional lucide icon for the coaching surface. */
  emptyIcon?: LucideIcon;
  count: number;
  children: ReactNode;
}

export function RelatedSection({
  title,
  entity,
  ctaLabel,
  ctaHref,
  isLoading,
  emptyExplainer,
  emptyIcon,
  count,
  children,
}: RelatedSectionProps) {
  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-display tracking-wide text-ink">{title}</h2>
        <Link
          to={ctaHref}
          className="px-3 py-1 bg-bg-2 border border-line font-display tracking-wider text-xs"
        >
          {ctaLabel.toUpperCase()}
        </Link>
      </header>
      {isLoading ? (
        <p className="font-sans text-sm text-ink-dim">Loading.</p>
      ) : count > 0 ? (
        <ul className="flex flex-col gap-1">{children}</ul>
      ) : (
        <DetailSectionEmptyCoaching
          entity={entity}
          explainer={emptyExplainer}
          ctaLabel={ctaLabel}
          ctaTo={ctaHref}
          icon={emptyIcon}
        />
      )}
    </section>
  );
}
