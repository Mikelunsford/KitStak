import { Fragment } from 'react';
import { Link } from 'react-router-dom';

/**
 * Breadcrumbs. Renders the parent-chain trail at the top of a detail page
 * so the operator can hop back up the workflow (Customer -> Quote -> Project)
 * without losing context. Implements UX-Q10 from the 2026-05-21 UX revision
 * walk.
 *
 * Sits ABOVE the page <h1> (and above any NextStepCTA from #106) so the
 * navigation context is the first thing the operator sees when they land
 * on a deep record.
 *
 * Separator is a centered dot (`·`) per CLAUDE.md's branding rule that
 * forbids em dashes and double hyphens in user-facing copy.
 *
 * The trailing item is treated as the current page (no link, accent
 * styling) — callers SHOULD pass it with `to` omitted. If only one item
 * is provided, the component renders nothing: a single non-clickable
 * label is not a breadcrumb.
 */

export interface BreadcrumbItem {
  /** Display label. Resolved human-readable name, not a UUID. */
  label: string;
  /**
   * Optional href. If omitted, the item is the current page and renders
   * as plain text (non-clickable, accent-styled). At least one item in
   * the trail should omit this — typically the last one.
   */
  to?: string;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
}

export function Breadcrumbs({ items }: BreadcrumbsProps) {
  // A single-item or empty breadcrumb adds no navigational value. Render
  // nothing so we don't introduce visual chrome for no payoff.
  if (items.length < 2) {
    return null;
  }

  return (
    <nav
      aria-label="Breadcrumb"
      className="font-sans text-sm"
      data-testid="breadcrumbs"
    >
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          // Ancestor items use ink-dim resting and brighten on hover for
          // affordance. The current item uses brand ink (not accent — accent
          // is reserved for action CTAs per the design system).
          const labelClass = isLast
            ? 'text-ink font-medium'
            : 'text-ink-dim hover:text-ink transition-colors';
          // Long labels (e.g. "Some Very Long Customer Display Name") get
          // truncated on narrow viewports. max-w-[14rem] is a reasonable
          // ceiling that still fits the full chain on a mobile width.
          const truncateClass =
            'inline-block max-w-[14rem] truncate align-bottom';

          return (
            <Fragment key={`${index}-${item.label}`}>
              <li className="flex items-center">
                {item.to && !isLast ? (
                  <Link
                    to={item.to}
                    className={`${labelClass} ${truncateClass}`}
                    title={item.label}
                  >
                    {item.label}
                  </Link>
                ) : (
                  <span
                    className={`${labelClass} ${truncateClass}`}
                    title={item.label}
                    aria-current={isLast ? 'page' : undefined}
                  >
                    {item.label}
                  </span>
                )}
              </li>
              {!isLast && (
                <li
                  aria-hidden="true"
                  className="text-ink-dim select-none"
                  data-testid="breadcrumb-separator"
                >
                  ·
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
