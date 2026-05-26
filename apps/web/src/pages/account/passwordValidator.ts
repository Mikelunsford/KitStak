// Pure password-pair validator. Extracted from SecurityPage so unit tests
// can import it without pulling the Supabase client into the test context.
//
// F-Wave9-INVITE-PASSWORD-SETUP-01 (SPA half). Used by both SecurityPage
// (signed-in user changes their password) and RecoveryPage (recovery-token
// holder sets a new password). Returns null when the inputs are
// submittable, otherwise a short message describing the first failure.

export const MIN_PASSWORD_LENGTH = 8;

export function validatePasswordPair(input: {
  password: string;
  confirm: string;
}): string | null {
  if (input.password.length === 0 && input.confirm.length === 0) {
    return 'Enter a new password.';
  }
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (input.confirm.length === 0) {
    return 'Confirm the new password.';
  }
  if (input.password !== input.confirm) {
    return 'Passwords do not match.';
  }
  return null;
}
