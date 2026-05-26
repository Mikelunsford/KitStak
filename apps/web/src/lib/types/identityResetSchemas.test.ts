// Wire-shape tests for the password-reset Zod schemas.
//
// F-Wave9-INVITE-PASSWORD-SETUP-01 (SPA half). These schemas live in
// identity.ts and are byte-mirrored from supabase/functions/_shared/types/
// identity.ts. The contract parity test asserts the file contents match;
// this file pins the validation semantics so a future drift that mutates
// behaviour (e.g. allowing `accepted: false`) is caught at build time.

import { describe, it, expect } from 'vitest';

import {
  RequestPasswordResetSchema,
  RequestPasswordResetResponseSchema,
} from './identity';

describe('RequestPasswordResetSchema', () => {
  it('accepts a well-formed email', () => {
    const parsed = RequestPasswordResetSchema.safeParse({
      email: 'operator@example.test',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects a malformed email', () => {
    const parsed = RequestPasswordResetSchema.safeParse({
      email: 'not-an-email',
    });
    expect(parsed.success).toBe(false);
  });

  it('requires the email field', () => {
    const parsed = RequestPasswordResetSchema.safeParse({});
    expect(parsed.success).toBe(false);
  });
});

describe('RequestPasswordResetResponseSchema', () => {
  it('accepts the canonical { accepted: true } envelope', () => {
    const parsed = RequestPasswordResetResponseSchema.safeParse({
      accepted: true,
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects accepted: false (the endpoint MUST only return true)', () => {
    const parsed = RequestPasswordResetResponseSchema.safeParse({
      accepted: false,
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects missing accepted field', () => {
    const parsed = RequestPasswordResetResponseSchema.safeParse({});
    expect(parsed.success).toBe(false);
  });
});
