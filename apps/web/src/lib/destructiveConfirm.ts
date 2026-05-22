// UX-Q8: opinionated confirm wrapper. Returns true if the operator
// confirmed, false if cancelled. Centralised so the copy stays
// consistent across the SPA and the future swap to a styled
// Dialog component is a one-file change.
//
// The constitutional posture here is deliberate:
//   - window.confirm is browser-native, so no new top-level dependency.
//   - The destructive action itself still goes through the existing FSM
//     mutation; this helper is only the confirmation gate.
//   - Copy follows the Kitstak brand rules: no em dashes, no double
//     hyphens, no emojis. Verb-first action lines, one-sentence
//     consequence in plain English.
//
// The message-formatting is split out (`formatDestructiveMessage`) so it
// can be unit tested in a node environment without jsdom. The
// `destructiveConfirm` entrypoint is the side-effectful wrapper that
// actually calls `window.confirm`.
//
// Reference: the manufacturing-run Complete button at
// apps/web/src/pages/manufacturing/ManufacturingRunDetailPage.tsx was
// the existing precedent and is now routed through this helper with
// irreversible: true.

export interface DestructiveConfirmOptions {
  /** Verb-first action description without trailing punctuation. */
  action: string;
  /** One sentence describing the consequence in plain English. */
  consequence: string;
  /** When true, appends a "cannot be undone" footer line. */
  irreversible?: boolean;
}

/**
 * Build the dialog message for a destructive transition. Pure function:
 * no DOM access, no side effects, safe to unit test in a node env.
 */
export function formatDestructiveMessage(opts: DestructiveConfirmOptions): string {
  const lines = [
    opts.action + '?',
    '',
    opts.consequence,
  ];
  if (opts.irreversible) {
    lines.push('');
    lines.push('This action cannot be undone.');
  }
  return lines.join('\n');
}

/**
 * Show a confirmation dialog for a destructive state-machine transition.
 *
 * Returns true if the operator confirmed, false if they cancelled.
 * The caller is responsible for short-circuiting the mutation when this
 * returns false.
 *
 * Falls back to `false` when `window` is not present (e.g. SSR / node
 * test environments) so the destructive action is never triggered
 * silently. Browser-side, `window.confirm` is the SPA-default.
 */
export function destructiveConfirm(opts: DestructiveConfirmOptions): boolean {
  const message = formatDestructiveMessage(opts);
  if (typeof window === 'undefined' || typeof window.confirm !== 'function') {
    return false;
  }
  return window.confirm(message);
}
