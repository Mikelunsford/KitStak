// EntityLabel clickable treatment (R-W14-READ-02). Extracted into its own
// pure module so it can be unit-tested without importing EntityLabel's hook and
// Supabase-client chain.
//
// The clickable affordance is now weight plus a hover/focus color shift, not an
// underline. Bold is a non-color cue (WCAG 1.4.1) and the focus-visible ring
// keeps keyboard users oriented. PLAIN_CLASS keeps non-clickable labels at the
// same weight so a column reads consistently.

export const LINK_CLASS =
  'font-semibold text-ink hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export const PLAIN_CLASS = 'font-semibold text-ink';
