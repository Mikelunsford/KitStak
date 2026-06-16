// MFA (TOTP) service. Thin wrapper over the Supabase JS MFA API so the
// account-security UI does not reach into the SDK shape directly.
//
// R-W13-AUTH-01. The TOTP factor lifecycle lives entirely in Supabase Auth
// (auth.mfa_factors), so there is no Kitstak Edge endpoint, migration, or
// idempotency-table touch here: the SDK talks to the GoTrue MFA endpoints,
// which Supabase verifies and stores. The Kitstak side already enforces
// MFA where required via the has_verified_totp RPC + requireMfaVerified
// gate (supabase/functions/_shared/mfa.ts); this service is the enrollment
// and self-management half that lets a user create and remove the factor
// that gate reads.
//
// Enrollment is a three-step dance:
//   1. enroll()  -> returns { factorId, qrCodeSvg, secret, uri }. The factor
//      is created in the 'unverified' state. We show the QR + secret so the
//      user can add it to an authenticator app.
//   2. challenge(factorId) -> returns a challengeId.
//   3. verify(factorId, challengeId, code) -> promotes the factor to
//      'verified'. From this point has_verified_totp returns true.
// A factor left unverified is harmless (the gate only counts verified
// factors) but we expose unenroll() so a user can clean up or rotate.

import { supabase } from '@/lib/supabase';

export interface TotpEnrollment {
  /** Factor id returned by enroll; needed for challenge + verify. */
  factorId: string;
  /** SVG markup (data URI) of the otpauth QR code. */
  qrCodeSvg: string;
  /** Base32 secret for manual entry into an authenticator app. */
  secret: string;
  /** Full otpauth:// URI (also encoded in the QR). */
  uri: string;
}

export interface TotpFactorSummary {
  id: string;
  friendlyName: string | null;
  status: 'verified' | 'unverified';
  createdAt: string;
}

function messageFrom(error: { message?: string } | null, fallback: string): string {
  return error?.message && error.message.length > 0 ? error.message : fallback;
}

/** List the caller's TOTP factors. */
export async function listTotpFactors(): Promise<TotpFactorSummary[]> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) {
    throw new Error(messageFrom(error, 'Could not load your security factors.'));
  }
  const totp = data?.totp ?? [];
  return totp.map((f) => ({
    id: f.id,
    friendlyName: f.friendly_name ?? null,
    status: f.status === 'verified' ? 'verified' : 'unverified',
    createdAt: f.created_at,
  }));
}

/** Begin TOTP enrollment. Returns the QR code + secret to display. */
export async function enrollTotp(friendlyName?: string): Promise<TotpEnrollment> {
  // exactOptionalPropertyTypes: only set friendlyName when provided rather
  // than passing an explicit undefined.
  const params =
    friendlyName !== undefined
      ? { factorType: 'totp' as const, friendlyName }
      : { factorType: 'totp' as const };
  const { data, error } = await supabase.auth.mfa.enroll(params);
  if (error || !data) {
    throw new Error(messageFrom(error, 'Could not start authenticator setup.'));
  }
  // The TOTP overload narrows the response to the totp shape; assert it so
  // the union (totp | phone | webauthn) collapses to the fields we read.
  const totp = data as { id: string; totp: { qr_code: string; secret: string; uri: string } };
  return {
    factorId: totp.id,
    qrCodeSvg: totp.totp.qr_code,
    secret: totp.totp.secret,
    uri: totp.totp.uri,
  };
}

/**
 * Verify a six-digit code against a pending factor. challengeAndVerify
 * collapses the challenge + verify round-trips into one SDK call so the
 * UI only needs the factor id and the code.
 */
export async function verifyTotp(
  factorId: string,
  code: string,
): Promise<void> {
  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId,
    code,
  });
  if (error) {
    throw new Error(
      messageFrom(error, 'That code did not match. Check your authenticator app and try again.'),
    );
  }
}

/** Remove a factor (verified or pending). */
export async function unenrollTotp(factorId: string): Promise<void> {
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) {
    throw new Error(messageFrom(error, 'Could not remove that factor.'));
  }
}
