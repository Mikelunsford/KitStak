// F-UIUX-TOASTS-01: Pattern A "next-step" success toasts. After a save or
// transition, the confirmation toast states what happened and names the primary
// next verb, so finishing a flow is a guided path rather than a guess.
//
// Thin wrapper over sonner (the toast library already mounted in main.tsx) so
// call sites do not import sonner directly and the optional next-step action has
// one consistent shape. The message text is built by the caller, often from a
// pure, unit-tested helper, so the wording stays testable without a renderer.

import { toast } from 'sonner';

export interface NextStepToastAction {
  /** Imperative verb for the toast's action button, e.g. "View project". */
  label: string;
  onClick: () => void;
}

/**
 * Fire a success toast. When `action` is supplied, the toast offers the next
 * step as a clickable button. Side-effect only.
 */
export function nextStepToast(
  message: string,
  action?: NextStepToastAction,
): void {
  toast.success(message, action ? { action } : undefined);
}
