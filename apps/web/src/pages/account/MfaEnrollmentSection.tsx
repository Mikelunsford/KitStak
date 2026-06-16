// Two-factor (TOTP) enrollment and management. R-W13-AUTH-01.
//
// Surfaced inside /account/security beneath the password form. Any signed-in
// user can add an authenticator app, verify it, and remove it. The factor
// lifecycle is handled by Supabase Auth via mfaService; no Kitstak Edge
// endpoint, migration, or idempotency-table touch.
//
// Flow:
//   - On mount we load the user's existing TOTP factors. A verified factor
//     renders the "two-factor is on" state with a Remove action. No factor
//     (or only an abandoned pending one) renders the "Set up" call to action.
//   - Set up calls enroll(), shows the QR code + manual secret, and asks the
//     user to enter the six-digit code from their app. Verify promotes the
//     factor to verified.
//   - Remove unenrolls the factor.
//
// Copy discipline: brand voice, no em dash, no double hyphen, no emoji.

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ShieldCheck, ShieldAlert, ShieldQuestion } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import {
  enrollTotp,
  listTotpFactors,
  unenrollTotp,
  verifyTotp,
  type TotpEnrollment,
  type TotpFactorSummary,
} from '@/lib/services/mfaService';
import { TOTP_CODE_LENGTH, isTotpCodeComplete } from './mfaCode';

type LoadState =
  | { status: 'loading' }
  | { status: 'loaded'; factors: TotpFactorSummary[] }
  | { status: 'error'; message: string };

type EnrollState =
  | { status: 'idle' }
  | { status: 'starting' }
  | { status: 'pending'; enrollment: TotpEnrollment }
  | { status: 'verifying'; enrollment: TotpEnrollment }
  | { status: 'error'; message: string; enrollment: TotpEnrollment | null };

export function MfaEnrollmentSection() {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [enroll, setEnroll] = useState<EnrollState>({ status: 'idle' });
  const [code, setCode] = useState('');
  const [removingId, setRemovingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoad({ status: 'loading' });
    try {
      const factors = await listTotpFactors();
      setLoad({ status: 'loaded', factors });
    } catch (err) {
      setLoad({
        status: 'error',
        message: err instanceof Error ? err.message : 'Could not load factors.',
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const verifiedFactor =
    load.status === 'loaded'
      ? load.factors.find((f) => f.status === 'verified') ?? null
      : null;

  async function onStartEnroll() {
    setEnroll({ status: 'starting' });
    setCode('');
    try {
      const enrollment = await enrollTotp('Authenticator app');
      setEnroll({ status: 'pending', enrollment });
    } catch (err) {
      setEnroll({
        status: 'error',
        message: err instanceof Error ? err.message : 'Could not start setup.',
        enrollment: null,
      });
    }
  }

  async function onVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const enrollment =
      enroll.status === 'pending'
        ? enroll.enrollment
        : enroll.status === 'error'
          ? enroll.enrollment
          : null;
    if (!enrollment) return;
    if (!isTotpCodeComplete(code)) return;

    setEnroll({ status: 'verifying', enrollment });
    try {
      await verifyTotp(enrollment.factorId, code.trim());
      setEnroll({ status: 'idle' });
      setCode('');
      await refresh();
    } catch (err) {
      setEnroll({
        status: 'error',
        message:
          err instanceof Error
            ? err.message
            : 'That code did not match. Try again.',
        enrollment,
      });
    }
  }

  function onCancelEnroll() {
    // Leave the unverified factor in place (harmless; the gate only counts
    // verified factors). The next Set up click creates a fresh one.
    setEnroll({ status: 'idle' });
    setCode('');
  }

  async function onRemove(factorId: string) {
    setRemovingId(factorId);
    try {
      await unenrollTotp(factorId);
      await refresh();
    } catch (err) {
      setLoad({
        status: 'error',
        message: err instanceof Error ? err.message : 'Could not remove factor.',
      });
    } finally {
      setRemovingId(null);
    }
  }

  // The QR + code panel renders whenever an enrollment is in flight: pending
  // (just enrolled), verifying (submitting), or error-with-enrollment (a bad
  // code, keep the panel so the user can retry).
  const activeEnrollment: TotpEnrollment | null =
    enroll.status === 'pending' || enroll.status === 'verifying'
      ? enroll.enrollment
      : enroll.status === 'error'
        ? enroll.enrollment
        : null;

  return (
    <section
      className="border border-line bg-bg-2 p-5 flex flex-col gap-4"
      data-testid="mfa-section"
    >
      <header className="flex items-center gap-3">
        {verifiedFactor ? (
          <ShieldCheck
            size={24}
            strokeWidth={2}
            className="text-success"
            aria-hidden="true"
          />
        ) : (
          <ShieldQuestion
            size={24}
            strokeWidth={2}
            className="text-ink-dim"
            aria-hidden="true"
          />
        )}
        <h2 className="font-display text-2xl tracking-wide text-ink">
          TWO-FACTOR AUTHENTICATION
        </h2>
      </header>

      <p className="font-sans text-sm text-ink-dim max-w-xl">
        Add a time-based code from an authenticator app as a second step when
        you sign in. This protects your account even if your password is
        exposed.
      </p>

      {load.status === 'loading' ? (
        <p className="font-sans text-sm text-ink-dim" data-testid="mfa-loading">
          Loading.
        </p>
      ) : null}

      {load.status === 'error' ? (
        <p
          role="alert"
          className="font-sans text-sm text-accent border-l-2 border-accent pl-3 py-2 bg-accent/5"
          data-testid="mfa-load-error"
        >
          {load.message}
        </p>
      ) : null}

      {/* Verified state. */}
      {verifiedFactor ? (
        <div
          className="flex items-center justify-between gap-4 border border-line px-4 py-3"
          data-testid="mfa-verified-state"
        >
          <div className="flex items-center gap-3">
            <ShieldCheck
              size={20}
              strokeWidth={2}
              className="text-success"
              aria-hidden="true"
            />
            <div className="flex flex-col">
              <span className="font-sans text-sm text-ink">
                Two-factor authentication is on.
              </span>
              <span className="font-sans text-xs text-ink-faint">
                {verifiedFactor.friendlyName ?? 'Authenticator app'}
              </span>
            </div>
          </div>
          <Button
            variant="ghost"
            onClick={() => void onRemove(verifiedFactor.id)}
            disabled={removingId === verifiedFactor.id}
            data-testid="mfa-remove-button"
          >
            {removingId === verifiedFactor.id ? 'Removing...' : 'Remove'}
          </Button>
        </div>
      ) : null}

      {/* Idle, no verified factor: show the Set up call to action. */}
      {load.status === 'loaded' && !verifiedFactor && enroll.status === 'idle' ? (
        <div>
          <Button onClick={() => void onStartEnroll()} data-testid="mfa-setup-button">
            Set up authenticator app
          </Button>
        </div>
      ) : null}

      {enroll.status === 'starting' ? (
        <p className="font-sans text-sm text-ink-dim" data-testid="mfa-starting">
          Preparing setup.
        </p>
      ) : null}

      {/* Pending / verifying / error-with-enrollment: show QR + code form. */}
      {activeEnrollment ? (
        <div
          className="flex flex-col gap-4 border border-line p-4"
          data-testid="mfa-enroll-panel"
        >
          <ol className="font-sans text-sm text-ink-dim flex flex-col gap-1 list-decimal pl-5">
            <li>Open your authenticator app and scan this QR code.</li>
            <li>Or enter the setup key by hand if you cannot scan.</li>
            <li>Type the six-digit code the app shows to confirm.</li>
          </ol>

          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <div
              className="border border-line bg-bg p-2"
              data-testid="mfa-qr"
              // The Supabase SDK returns the QR as an SVG data URI. Render it
              // as an image; it is generated client side from the user's own
              // secret, never injected HTML.
            >
              <img
                src={activeEnrollment.qrCodeSvg}
                alt="Authenticator setup QR code"
                width={160}
                height={160}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="font-sans text-xs uppercase tracking-wide text-ink-dim">
                Setup key
              </span>
              <code
                className="font-mono text-sm text-ink break-all"
                data-testid="mfa-secret"
              >
                {activeEnrollment.secret}
              </code>
            </div>
          </div>

          <form onSubmit={onVerify} className="flex flex-col gap-3">
            <TextInput
              label="Six-digit code"
              name="totp_code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={TOTP_CODE_LENGTH}
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/[^\d]/g, '').slice(0, TOTP_CODE_LENGTH))
              }
              data-testid="mfa-code-input"
            />

            {enroll.status === 'error' ? (
              <p
                role="alert"
                className="font-sans text-sm text-accent border-l-2 border-accent pl-3 py-2 bg-accent/5"
                data-testid="mfa-verify-error"
              >
                {enroll.message}
              </p>
            ) : null}

            <div className="flex items-center gap-3">
              <Button
                type="submit"
                disabled={!isTotpCodeComplete(code) || enroll.status === 'verifying'}
                data-testid="mfa-verify-button"
              >
                {enroll.status === 'verifying' ? 'Verifying...' : 'Verify and enable'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={onCancelEnroll}
                data-testid="mfa-cancel-button"
              >
                Cancel
              </Button>
            </div>
          </form>
        </div>
      ) : null}

      {/* Pending-but-not-verified factors with no verified factor: gentle note. */}
      {load.status === 'loaded' &&
      !verifiedFactor &&
      enroll.status === 'idle' &&
      load.factors.some((f) => f.status === 'unverified') ? (
        <p
          className="font-sans text-xs text-ink-faint flex items-center gap-2"
          data-testid="mfa-pending-note"
        >
          <ShieldAlert size={14} strokeWidth={2} aria-hidden="true" />
          You have a setup that was never finished. Start again to complete it.
        </p>
      ) : null}
    </section>
  );
}
