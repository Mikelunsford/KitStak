import { Link } from 'react-router-dom';

/**
 * NextStepCTA. Promotes the "next step" forward-transition on a detail page
 * to a visually primary, top-of-page CTA so the operator follows the workflow
 * forward without bouncing back to a list. Implements UX-Q4 from the
 * 2026-05-21 UX revision walk.
 *
 * Sits below the page header (h1 + status pill) and above the dl/data
 * sections. Cancel / revise / sideways FSM transitions stay visible on the
 * page as a secondary cluster — they are NOT hidden, just demoted, so an
 * operator who legitimately needs to cancel can still see the control.
 *
 * Two action shapes are supported and are mutually exclusive:
 *   * `onClick` for a mutation-style action (e.g. convert quote to project).
 *     The CTA renders as a <button> and respects `pending`.
 *   * `to` for a navigation-style link (e.g. open the create-shipment form
 *     pre-filled with project_id). The CTA renders as a react-router <Link>.
 *
 * If both are supplied, the component throws in development so the wiring
 * mistake surfaces immediately instead of falling back to a quiet default.
 */
export interface NextStepCTAProps {
  /** Action label. Imperative phrase, e.g. "Convert to project". */
  label: string;
  /** Mutation-style action. Mutually exclusive with `to`. */
  onClick?: () => void;
  /** Navigation-style action. Mutually exclusive with `onClick`. */
  to?: string;
  /** Set true while a mutation is in flight to disable + show "Working." */
  pending?: boolean;
  /** Optional error message rendered below the CTA in accent color. */
  error?: string | null;
}

export function NextStepCTA(props: NextStepCTAProps) {
  const { label, onClick, to, pending = false, error = null } = props;

  if (onClick && to) {
    throw new Error(
      'NextStepCTA: pass either `onClick` or `to`, not both.',
    );
  }
  if (!onClick && !to) {
    throw new Error(
      'NextStepCTA: must pass either `onClick` or `to`.',
    );
  }

  // Brand-aligned primary button styling. Matches `Button.tsx` primary variant
  // (bg-accent + hover:bg-accent-bright) but bumps padding/typography for
  // top-of-page prominence and goes full-width on small screens so the touch
  // target is generous on mobile. No new utility class additions — uses tokens
  // already in the Tailwind config (accent, ink, bg-1).
  const className =
    'block w-full sm:w-auto px-6 py-3 font-sans font-medium tracking-wide uppercase text-sm ' +
    'bg-accent text-ink hover:bg-accent-bright ' +
    'transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ' +
    'disabled:opacity-50 disabled:cursor-not-allowed text-center';

  return (
    <div className="flex flex-col gap-2">
      {to ? (
        <Link
          to={to}
          className={className}
          aria-label={label}
          data-testid="next-step-cta-link"
        >
          {label}
        </Link>
      ) : (
        <button
          type="button"
          onClick={onClick}
          disabled={pending}
          className={className}
          data-testid="next-step-cta-button"
        >
          {pending ? 'Working.' : label}
        </button>
      )}
      {error && (
        <p
          className="font-sans text-sm text-accent"
          data-testid="next-step-cta-error"
        >
          {error}
        </p>
      )}
    </div>
  );
}
