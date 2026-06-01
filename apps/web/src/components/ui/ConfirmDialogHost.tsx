// F-Wave10-SMOKE-CONFIRM-MODAL-01: the single in-app confirmation modal that
// backs destructiveConfirm. Mounted once at the app root. It registers an
// opener via setConfirmOpener; destructiveConfirm(opts) calls that opener and
// awaits the operator's choice.
//
// Why a global host instead of a per-page <Dialog>: every destructive onClick
// already calls destructiveConfirm() imperatively, so a promise-returning
// global keeps those call sites a one-line change (await) instead of threading
// open/close state through every detail page.
//
// Accessibility + brand: role=dialog + aria-modal, labelled by the action,
// Escape and backdrop-click cancel, the confirm button is focused on open, and
// the destructive confirm uses the accent colour. No new dependency.

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  setConfirmOpener,
  type DestructiveConfirmOptions,
} from '@/lib/destructiveConfirm';

interface PendingConfirm {
  opts: DestructiveConfirmOptions;
  resolve: (confirmed: boolean) => void;
}

export function ConfirmDialogHost() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setConfirmOpener(
      (opts) =>
        new Promise<boolean>((resolve) => {
          setPending({ opts, resolve });
        }),
    );
    return () => setConfirmOpener(null);
  }, []);

  const close = useCallback(
    (confirmed: boolean) => {
      setPending((cur) => {
        cur?.resolve(confirmed);
        return null;
      });
    },
    [],
  );

  useEffect(() => {
    if (!pending) return;
    confirmRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, close]);

  if (!pending) return null;
  const { opts } = pending;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={() => close(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-action"
        className="w-full max-w-md border border-line bg-bg-2 p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="confirm-dialog-action"
          className="font-display tracking-wide text-2xl text-ink"
        >
          {opts.action}?
        </h2>
        <p className="mt-3 font-sans text-sm text-ink-dim">{opts.consequence}</p>
        {opts.irreversible ? (
          <p className="mt-2 font-sans text-sm text-accent">
            This action cannot be undone.
          </p>
        ) : null}
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={() => close(false)}
            className="px-4 py-2 border border-line font-sans text-xs uppercase tracking-wide text-ink hover:bg-bg"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            onClick={() => close(true)}
            className="px-4 py-2 border border-accent bg-accent font-sans text-xs uppercase tracking-wide text-ink hover:opacity-90"
          >
            {opts.action}
          </button>
        </div>
      </div>
    </div>
  );
}
