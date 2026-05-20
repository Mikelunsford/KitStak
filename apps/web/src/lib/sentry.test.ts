// F-Wave5-CO-01 / F-Wave3-OBS-01 (SPA portion): unit coverage for the
// Sentry wrapper. Focuses on the constitutional pieces:
//
//   - No-op when VITE_SENTRY_DSN is absent (no network, no module load).
//   - PII scrub in beforeSend (email, IP, cookies, Authorization, query
//     strings, contexts, tags, message-level email patterns).
//   - identifySentryUser only carries the opaque Supabase UUID.
//   - captureException short-circuits before init or in dev.

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  initSentry,
  identifySentryUser,
  resetSentryUser,
  captureException,
  scrubEvent,
  __resetForTests,
} from './sentry';

beforeEach(() => {
  __resetForTests();
  vi.unstubAllEnvs();
});

describe('initSentry', () => {
  it('resolves to a no-op when VITE_SENTRY_DSN is absent', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', '');
    await expect(initSentry()).resolves.toBeUndefined();
  });

  it('returns the same promise on repeat calls', () => {
    vi.stubEnv('VITE_SENTRY_DSN', '');
    const a = initSentry();
    const b = initSentry();
    expect(a).toBe(b);
  });
});

describe('identifySentryUser', () => {
  it('is a silent no-op when sentry has not been initialised', () => {
    expect(() => identifySentryUser('user-uuid-1234')).not.toThrow();
  });

  it('is a silent no-op when given an empty user id', () => {
    expect(() => identifySentryUser('')).not.toThrow();
  });
});

describe('resetSentryUser', () => {
  it('is a silent no-op when sentry has not been initialised', () => {
    expect(() => resetSentryUser()).not.toThrow();
  });
});

describe('captureException', () => {
  it('is a silent no-op when sentry has not been initialised', () => {
    expect(() =>
      captureException(new Error('test'), { componentStack: 'stack' }),
    ).not.toThrow();
  });
});

describe('scrubEvent (PII scrub)', () => {
  it('strips user.email, user.ip_address, user.username; keeps user.id', () => {
    const event = {
      user: {
        id: 'opaque-uuid',
        email: 'jane@example.com',
        username: 'jane',
        ip_address: '203.0.113.42',
      },
    } as unknown as Parameters<typeof scrubEvent>[0];

    const out = scrubEvent(event);
    expect(out).not.toBeNull();
    expect(out!.user).toEqual({ id: 'opaque-uuid' });
  });

  it('clears user entirely when only PII fields are present (no id)', () => {
    const event = {
      user: { email: 'jane@example.com' },
    } as unknown as Parameters<typeof scrubEvent>[0];

    const out = scrubEvent(event);
    expect(out).not.toBeNull();
    expect(out!.user).toBeUndefined();
  });

  it('strips request.cookies and Authorization header', () => {
    const event = {
      request: {
        url: 'https://app.kitstak.com/dashboard',
        cookies: { session: 'abc' },
        headers: {
          authorization: 'Bearer secret',
          'content-type': 'application/json',
        },
      },
    } as unknown as Parameters<typeof scrubEvent>[0];

    const out = scrubEvent(event);
    expect(out!.request!.cookies).toBeUndefined();
    expect(out!.request!.headers).toEqual({ 'content-type': 'application/json' });
  });

  it('strips Authorization header regardless of case', () => {
    const event = {
      request: {
        url: 'https://app.kitstak.com/x',
        headers: { Authorization: 'Bearer secret' },
      },
    } as unknown as Parameters<typeof scrubEvent>[0];

    const out = scrubEvent(event);
    expect(
      (out!.request!.headers as Record<string, string>).Authorization,
    ).toBeUndefined();
  });

  it('strips query string from request.url and clears query_string', () => {
    const event = {
      request: {
        url: 'https://app.kitstak.com/invoices?email=jane@example.com&id=42',
        query_string: 'email=jane@example.com&id=42',
      },
    } as unknown as Parameters<typeof scrubEvent>[0];

    const out = scrubEvent(event);
    expect(out!.request!.url).toBe('https://app.kitstak.com/invoices');
    expect(out!.request!.query_string).toBeUndefined();
  });

  it('redacts email and phone patterns inside extra', () => {
    const event = {
      extra: {
        note: 'hello',
        leak: 'contact jane@example.com for help',
        phone: '+1 (555) 123-4567',
      },
    } as unknown as Parameters<typeof scrubEvent>[0];

    const out = scrubEvent(event);
    expect(out!.extra).toEqual({
      note: 'hello',
      leak: '[redacted]',
      phone: '[redacted]',
    });
  });

  it('drops the event when message contains an email pattern', () => {
    const event = {
      message: 'failed for user jane@example.com',
    } as unknown as Parameters<typeof scrubEvent>[0];

    const out = scrubEvent(event);
    expect(out).toBeNull();
  });

  it('drops the event when an exception value contains an email pattern', () => {
    const event = {
      exception: {
        values: [
          { type: 'Error', value: 'lookup failed for jane@example.com' },
        ],
      },
    } as unknown as Parameters<typeof scrubEvent>[0];

    const out = scrubEvent(event);
    expect(out).toBeNull();
  });

  it('passes through a benign event unchanged', () => {
    const event = {
      message: 'render error',
      exception: { values: [{ type: 'TypeError', value: 'cannot read x of undefined' }] },
      user: { id: 'opaque-uuid' },
      tags: { route: '/dashboard' },
      extra: { component: 'InvoiceDetailPage' },
    } as unknown as Parameters<typeof scrubEvent>[0];

    const out = scrubEvent(event);
    expect(out).not.toBeNull();
    expect(out!.message).toBe('render error');
    expect(out!.user).toEqual({ id: 'opaque-uuid' });
    expect(out!.tags).toEqual({ route: '/dashboard' });
    expect(out!.extra).toEqual({ component: 'InvoiceDetailPage' });
  });
});
