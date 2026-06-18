// Modal. The reusable hand-rolled dialog primitive (F-UIUX-ENTITYPICKER-01).
//
// Hand-rolled per the constitution: no Radix, no headless lib. It standardizes
// the dialog chrome that ConfirmDialogHost and ReceivePaymentModal each
// re-implemented, and adds the three things those one-offs skipped: a Tab focus
// trap, body scroll lock while open, and focus restore to the trigger on close.
//
// Accessibility + brand: role=dialog + aria-modal, labelled by the title,
// Escape and backdrop-click close, the first focusable control is focused on
// open. Tailwind utilities only, brand tokens from the existing palette.

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

// Tabbable controls inside the dialog. Used for the focus trap and to focus the
// first control on open.
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Dialog heading. Also the accessible name via aria-labelledby. */
  title: string;
  children: ReactNode;
  /** Optional actions row pinned to the bottom right. */
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

const SIZE_CLASS: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
};

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}: ModalProps): JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  // On open: remember the trigger, focus the first control. On close (effect
  // cleanup): return focus to the trigger so keyboard users are not dropped at
  // the top of the page.
  useEffect(() => {
    if (!open) return;
    restoreRef.current = (document.activeElement as HTMLElement | null) ?? null;
    const handle = window.setTimeout(() => {
      const node = dialogRef.current;
      if (!node) return;
      const first = node.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (first ?? node).focus();
    }, 0);
    return () => {
      window.clearTimeout(handle);
      restoreRef.current?.focus?.();
    };
  }, [open]);

  // Lock body scroll while the modal is open so the page behind does not move.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const node = dialogRef.current;
      if (!node) return;
      const focusables = Array.from(
        node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) {
        e.preventDefault();
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  if (!open) return null;
  // Portal to document.body so the dialog (and any <form> a quick-create modal
  // renders inside it) is never nested inside a parent page <form>. Nested forms
  // are invalid HTML and silently break the inner form's submit, which is what
  // killed the inline quick-create flow when a picker was hosted in a create form.
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onMouseDown={() => onClose()}
    >
      {/* A quick-create modal renders its own <form> in `children`. The modal is
          portaled but stays a React child of the host page (often a create
          <form>), and React event bubbling follows the component tree, not the
          DOM. Without this, the modal's submit bubbles up to the host form and
          fires it too, e.g. creating an empty quote when you only meant to add a
          customer. Stop submit at the dialog boundary; the modal's own onSubmit
          has already run by the time the event reaches here. */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`relative w-full ${SIZE_CLASS[size]} border border-line bg-bg-2 p-6 shadow-xl`}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        onSubmit={(e) => e.stopPropagation()}
      >
        <h2
          id={titleId}
          className="font-display tracking-wide text-2xl text-ink"
        >
          {title}
        </h2>
        <div className="mt-4">{children}</div>
        {footer ? (
          <div className="mt-6 flex justify-end gap-3">{footer}</div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
