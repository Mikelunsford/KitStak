// Pure TOTP-code helper for the MFA enrollment surface. R-W13-AUTH-01.
//
// Kept out of MfaEnrollmentSection.tsx so it can be unit-tested in a node
// environment without importing the component (which transitively pulls in
// the Supabase client and its required env vars). Matches the repo no-jsdom,
// pure-helper convention (passwordValidator.ts, membersInviteForm.ts).

// A TOTP code is always six digits.
export const TOTP_CODE_LENGTH = 6;

/** True when the input is exactly six digits (after trimming). */
export function isTotpCodeComplete(code: string): boolean {
  return /^\d{6}$/.test(code.trim());
}
