// UX-Q8 / F-Wave10-SMOKE-CONFIRM-MODAL-01: opinionated confirm gate for
// destructive state-machine transitions. Returns a promise that resolves
// true if the operator confirmed, false if they cancelled.
//
// Originally this called window.confirm (browser-native, zero deps). The
// 2026-06-01 Co-Pack/KitForce smoke flagged the native dialog as off-brand
// and as a blocker for automated E2E (a native confirm freezes the runner).
// It is now backed by an in-app modal: a single ConfirmDialogHost mounted at
// the app root registers an opener via setConfirmOpener, and destructiveConfirm
// drives it. No new top-level dependency; the modal is hand-rolled on the
// existing primitives.
//
// Call-site contract is unchanged except for async:
//   if (!(await destructiveConfirm({ action, consequence }))) return;
//   mutation();
//
// Copy still follows the Kitstak brand rules: no em dashes, no double
// hyphens, no emojis. Verb-first action lines, one-sentence consequence.
//
// formatDestructiveMessage stays a pure function so it can be unit tested in
// a node environment without jsdom, and so a plain-text fallback message is
// available if ever needed.

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

export type ConfirmOpener = (opts: DestructiveConfirmOptions) => Promise<boolean>;

// Module-level registration slot. The ConfirmDialogHost (mounted once at the
// app root) registers its opener here on mount and clears it on unmount.
let opener: ConfirmOpener | null = null;

export function setConfirmOpener(fn: ConfirmOpener | null): void {
  opener = fn;
}

/**
 * Show the in-app confirmation modal for a destructive transition.
 *
 * Resolves true if the operator confirmed, false if they cancelled. The
 * caller short-circuits the mutation when this resolves false.
 *
 * When no host is mounted (SSR, node test env, or before first paint) this
 * resolves false so a destructive action is never triggered silently. That
 * preserves the original window.confirm posture.
 */
export function destructiveConfirm(opts: DestructiveConfirmOptions): Promise<boolean> {
  if (!opener) return Promise.resolve(false);
  return opener(opts);
}
