// Regression suite for Path B1 — Resend HTTP wire in
// `supabase/functions/_shared/notifications/senders.ts`.
//
// Tests the emailSender directly (no notifications-worker harness) so we can
// assert the exact Resend POST shape, header set, and result-mapping for
// success / 4xx / 5xx / network-error paths.
//
// Closes the verifiable side of F-Wave6-NOTIF-01 for the email channel:
// once these tests pass, the worker can call senderFor('email') with a
// real Resend transport instead of returning the prior stub.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { installDenoShim } from './_helpers/deno-shim.ts';

let senderFor: typeof import(
  '../../../../supabase/functions/_shared/notifications/senders.ts'
).senderFor;

const ROW_ID = '00000000-0000-4000-8000-00000000d001';
const ORG_ID = '00000000-0000-4000-8000-0000000000a1';
const RECIPIENT = 'customer@example.test';
const FROM = 'noreply@kitstak.test';
const API_KEY = 're_test_fake_key_value';

function makeRow(overrides: Partial<{
  payload: Record<string, unknown>;
  subject: string;
  body: string | null;
}> = {}) {
  return {
    id: ROW_ID,
    org_id: ORG_ID,
    recipient_user_id: '00000000-0000-4000-8000-0000000000b1',
    channel: 'email',
    subject: overrides.subject ?? 'Quote 0001',
    body: overrides.body ?? 'Body text',
    payload: overrides.payload ?? { to: RECIPIENT },
  };
}

describe('emailSender (Resend HTTP wire) — Path B1', () => {
  let envMap: Record<string, string>;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    installDenoShim();
    const mod = await import(
      '../../../../supabase/functions/_shared/notifications/senders.ts'
    );
    senderFor = mod.senderFor;
  });

  beforeEach(() => {
    envMap = {
      EMAIL_PROVIDER: 'resend',
      RESEND_API_KEY: API_KEY,
      RESEND_FROM: FROM,
    };
    // Override the deno-shim's frozen FAKE_ENV for this test scope.
    vi.spyOn(globalThis.Deno!.env, 'get').mockImplementation(
      (key: string) => envMap[key],
    );
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns transport_not_configured when EMAIL_PROVIDER is unset', async () => {
    envMap = {};
    const sender = senderFor('email');
    const result = await sender(makeRow());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('transport_not_configured');
      expect(result.retryable).toBe(false);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns transport_not_configured when RESEND_API_KEY is missing', async () => {
    delete envMap.RESEND_API_KEY;
    const result = await senderFor('email')(makeRow());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('transport_not_configured');
      expect(result.retryable).toBe(false);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns transport_not_configured when RESEND_FROM is missing', async () => {
    delete envMap.RESEND_FROM;
    const result = await senderFor('email')(makeRow());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('transport_not_configured');
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns transport_not_configured when payload.to is absent', async () => {
    const result = await senderFor('email')(makeRow({ payload: {} }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('transport_not_configured');
      expect(result.retryable).toBe(false);
      expect(result.message).toMatch(/payload\.to/);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('posts to api.resend.com/emails with Bearer auth and the right body on success', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'resend_msg_abc' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const row = makeRow({ subject: 'Quote 0001', body: 'Hi,\n\nReview your quote.' });
    const result = await senderFor('email')(row);

    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${API_KEY}`);
    expect(headers['content-type']).toBe('application/json');
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody).toMatchObject({
      from: FROM,
      to: RECIPIENT,
      subject: 'Quote 0001',
      text: 'Hi,\n\nReview your quote.',
    });
  });

  it('maps 4xx response to transport_rejected non-retryable', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          name: 'validation_error',
          message: 'Invalid `to` field',
        }),
        { status: 422, headers: { 'content-type': 'application/json' } },
      ),
    );

    const result = await senderFor('email')(makeRow());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('transport_rejected');
      expect(result.retryable).toBe(false);
      expect(result.message).toMatch(/HTTP 422/);
      expect(result.message).toMatch(/validation_error/);
    }
  });

  it('maps 5xx response to transport_rejected retryable', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('upstream timeout', { status: 503 }),
    );

    const result = await senderFor('email')(makeRow());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('transport_rejected');
      expect(result.retryable).toBe(true);
      expect(result.message).toMatch(/HTTP 503/);
    }
  });

  it('maps network error to send_error retryable', async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError('failed to fetch'));

    const result = await senderFor('email')(makeRow());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('send_error');
      expect(result.retryable).toBe(true);
      expect(result.message).toMatch(/failed to fetch/);
    }
  });

  it('treats 201 and 202 as success (Resend may use either)', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 201 }));
    expect((await senderFor('email')(makeRow())).ok).toBe(true);
    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 202 }));
    expect((await senderFor('email')(makeRow())).ok).toBe(true);
  });
});
