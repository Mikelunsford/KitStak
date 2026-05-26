// DetailSectionEmptyCoaching. F-Wave9-DETAIL-EMPTY-COACHING-01.
//
// Compact, inline empty-state coaching surface that sits INSIDE an existing
// detail-page child section where today we render a plain `text-ink-dim`
// "No X yet." sentence. Sparse zero-state lists make a polished detail
// page look hollow in marketing screenshots; this component gives every
// related-entity section a single-line explainer plus an optional inline
// CTA so the operator always knows what the section is for and how to
// populate it.
//
// Posture differs from `ListEmptyState` (PR #119): that surface is the
// centered full-card empty state for a list PAGE. This component is the
// inline variant for a SECTION within a detail page. Smaller padding,
// horizontal layout, sits flush inside the existing section card.
//
// Visual family: bg-2 subtle background, line border, lucide icon at
// 20px in a small inset box matching the WorkCard / SetupChecklist
// icon treatment. CTA uses the same accent-on-hover convention as
// the existing "New X" header links on ProjectDetailPage / RelatedSection.
//
// Constitutional notes:
//   - No em dashes, double hyphens, or emojis in copy passed in.
//   - No new top-level dependencies. Tailwind tokens only.
//   - Brand discipline: explainer copy stays under the "Built to Ship."
//     voice. The caller owns the literal copy; this file only renders it.

import { Link } from 'react-router-dom';
import { Info, type LucideIcon } from 'lucide-react';

export interface DetailSectionEmptyCoachingProps {
  /**
   * Singular noun for the entity the empty section represents. Carried
   * through as a data attribute so tests can target the surface without
   * coupling to copy strings. Example: "phase", "shipment", "quote".
   */
  entity: string;
  /**
   * Sentence-cased one-line explainer. Should answer "what is this
   * section for?". Example:
   * "Phases break a project into trackable milestones."
   */
  explainer: string;
  /**
   * Optional CTA label. Imperative phrase, e.g. "Add phase". When both
   * `ctaLabel` and `ctaTo` are present the inline CTA renders. Either
   * one missing means the section is read-only or system-generated
   * (e.g. stock movements) and the explainer renders alone.
   */
  ctaLabel?: string;
  /**
   * Optional react-router target for the CTA. Must be paired with
   * `ctaLabel` for the CTA to render.
   */
  ctaTo?: string;
  /**
   * Optional lucide icon. Defaults to `Info`. Pick a domain-relevant
   * icon (Truck for shipments, Package for materials, etc.) where
   * one fits cleanly. Accepts `undefined` explicitly so callers under
   * `exactOptionalPropertyTypes` can pass an `icon?: LucideIcon` field
   * through without narrowing first.
   */
  icon?: LucideIcon | undefined;
}

/**
 * DetailSectionEmptyCoaching renders the inline empty-state coaching
 * block for a detail-page child section.
 *
 * Layout: horizontal flex row with a small icon tile on the left, the
 * explainer in the center, and an optional CTA link on the right. On
 * narrow widths the row wraps so the CTA drops below the explainer
 * instead of squeezing.
 */
export function DetailSectionEmptyCoaching({
  entity,
  explainer,
  ctaLabel,
  ctaTo,
  icon: Icon = Info,
}: DetailSectionEmptyCoachingProps) {
  const ctaVisible = Boolean(ctaLabel && ctaTo);

  return (
    <div
      className="flex flex-wrap items-center gap-3 border border-line bg-bg-2 px-4 py-3"
      data-testid="detail-section-empty-coaching"
      data-entity={entity}
    >
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center border border-line bg-bg-3 text-ink-dim"
        aria-hidden="true"
      >
        <Icon size={18} strokeWidth={1.5} />
      </div>
      <p
        className="flex-1 min-w-0 font-sans text-sm text-ink"
        data-testid="detail-section-empty-coaching-explainer"
      >
        {explainer}
      </p>
      {ctaVisible ? (
        <Link
          to={ctaTo as string}
          className="text-sm font-sans text-accent hover:text-accent-bright focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          data-testid="detail-section-empty-coaching-cta"
          aria-label={ctaLabel}
        >
          {ctaLabel}
        </Link>
      ) : null}
    </div>
  );
}
