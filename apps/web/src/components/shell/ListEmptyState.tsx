// ListEmptyState. UX-Q9 list-page empty-state surface.
//
// Renders a single centered card when a list page has zero rows: a short
// explainer of what the entity is and why operators create them, plus a
// primary "Add <entity>" call-to-action. Caps-gated callers pass
// `canAdd={false}` to hide the CTA without losing the explainer (e.g.
// stock movements, which are system-generated and have no create flow).
//
// Visual family mirrors WorkCard from PR #107: bg-2 surface, line border,
// accent on hover/focus, Bebas Neue display type for the action label.
// Brand tokens only (bg-2, line, ink, accent, font-display, font-sans) so
// BrandingProvider's runtime palette injection repaints cleanly.
//
// Constitutional notes:
//   - No em dashes, double hyphens, or emojis in copy.
//   - No new top-level dependencies. Tailwind + react-router-dom + lucide-react,
//     all already in the SPA bundle.

import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';

export interface ListEmptyStateProps {
  /**
   * Singular noun for the entity being listed. Used by tests and the
   * default ARIA label. Example: "vendor", "quote", "manufacturing run".
   */
  entity: string;
  /**
   * One-line, sentence-cased explainer of the entity. Should answer
   * "what is this and why would I create one?". Example:
   * "Vendors are the companies you buy materials from."
   */
  explainer: string;
  /**
   * Label rendered inside the primary CTA. Example: "Add vendor".
   * Required even when `canAdd` is false so a future capability flip
   * does not require a code change to surface a label.
   */
  addLabel: string;
  /**
   * Path the CTA navigates to. Example: "/purchasing/vendors/new".
   */
  addTo: string;
  /**
   * When false, the CTA is hidden but the explainer still renders. Used
   * by caps-gated callers (e.g. role lacks `vendors.vendor.create`) and
   * by entities with no user-facing create flow (e.g. stock movements).
   *
   * Defaults to true.
   */
  canAdd?: boolean;
}

/**
 * ListEmptyState renders the empty-state surface for a list page.
 *
 * Posture: centered single-column card, navy bg-2 with a line border that
 * pulls accent on hover for the CTA. Vertical rhythm picks up the
 * WorkCard family (PR #107). Width caps at `max-w-xl` so the surface does
 * not stretch on the wider list pages.
 */
export function ListEmptyState({
  entity,
  explainer,
  addLabel,
  addTo,
  canAdd = true,
}: ListEmptyStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-6 border border-line bg-bg-2 px-8 py-16 text-center"
      data-testid="list-empty-state"
      data-entity={entity}
    >
      <div
        className="flex h-14 w-14 items-center justify-center border border-line bg-bg-3 text-ink-dim"
        aria-hidden="true"
      >
        <Plus size={32} strokeWidth={1.5} />
      </div>
      <p
        className="max-w-md font-sans text-base text-ink"
        data-testid="list-empty-state-explainer"
      >
        {explainer}
      </p>
      {canAdd ? (
        <Link
          to={addTo}
          className="px-6 py-3 bg-accent text-on-primary font-display tracking-wider text-sm uppercase transition-colors hover:bg-accent-bright focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          data-testid="list-empty-state-cta"
          aria-label={addLabel}
        >
          {addLabel}
        </Link>
      ) : null}
    </div>
  );
}
