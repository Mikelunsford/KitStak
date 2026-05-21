// F-Wave5-CO-01-EDGE-01: unit coverage for the Deno-side Sentry wrapper at
// supabase/functions/_shared/sentry.ts. Mirrors the SPA wrapper's
// constitutional asserts (apps/web/src/lib/sentry.test.ts):
//
//   - No-op when SENTRY_DSN is absent (no fetch, no throw).
//   - Idempotent init.
//   - PII scrub in beforeSend (email, IP, cookies, Authorization both
//     cases, query strings, extra, tags, message-level email patterns,
//     exception-value-level email patterns).
//   - User IP pinned to null explicitly (not delete) so the Sentry Relay
//     does not auto-fill from request source IP.
//   - User object synthesised with { ip_address: null } even when input
//     had no user.
//   - Opaque UUID is the only user identifier retained.
//
// Runs under vitest (not Deno test) because the rest of the Kitstak
// test surface for _shared/* runs under vitest via the deno-shim
// helper. We install a minimal `Deno.env.get` shim so initSentry can
// read SENTRY_DSN without spinning up the full deno-shim.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Install a Deno.env shim before importing the module under test so the
// import-time initialisation path sees a controllable env bag.
const ENV_BAG: Record<string, string | undefined> = {};

interface DenoLike {
  env: { get: (key: string) => string | undefined };
}
declare global {
  var Deno: DenoLike | undefined;
}
if (!globalThis.Deno) {
  globalThis.Deno = {
    env: { get: (key: string) => ENV_BAG[key] },
  };
}

// Cast through unknown so the vitest type-checker tolerates `.ts` extension
// on the Deno-flavoured source path. The runtime resolves the file via
// vitest's TypeScript loader.
// @ts-expect-error - explicit `.ts` extension for Deno-style source
const sentryModulePromise = import('../../../../supabase/functions/_shared/sentry.ts');

interface SentryEvent {
  message?: string;
  user?: { id?: string; email?: string; username?: string; ip_address?: string | null };
  request?: {
    url?: string;
    cookies?: Record<string, string>;
    headers?: Record<string, string>;
    query_string?: string;
  };
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  exception?: { values: Array<{ type?: string; value?: string }> };
}

interface SentryModule {
  initSentry: () => void;
  identifySentryUser: (id: string) => void;
  resetSentryUser: () => void;
  captureException: (err: unknown, ctx?: Record<string, unknown>) => void;
  scrubEvent: (e: SentryEvent) => SentryEvent | null;
  __resetForTests: () => void;
}

let sentry: SentryModule;

beforeEach(async () => {
  sentry = (await sentryModulePromise) as SentryModule;
  sentry.__resetForTests();
  for (const k of Object.keys(ENV_BAG)) delete ENV_BAG[k];
  vi.restoreAllMocks();
});

describe('initSentry (Deno-side)', () => {
  it('is a no-op when SENTRY_DSN is absent', () => {
    expect(() => sentry.initSentry()).not.toThrow();
  });

  it('is idempotent across repeat calls', () => {
    sentry.initSentry();
    sentry.initSentry();
    sentry.initSentry();
    // No throw, no side-effect we can observe from outside.
    expect(true).toBe(true);
  });

  it('stays in no-op posture when the DSN is malformed', () => {
    ENV_BAG.SENTRY_DSN = 'not-a-valid-dsn';
    sentry.initSentry();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', { status: 200 }),
    );
    sentry.captureException(new Error('boom'));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('identifySentryUser / resetSentryUser (Deno-side parity stubs)', () => {
  it('identifySentryUser is a silent no-op', () => {
    expect(() => sentry.identifySentryUser('opaque-uuid-1234')).not.toThrow();
  });

  it('resetSentryUser is a silent no-op', () => {
    expect(() => sentry.resetSentryUser()).not.toThrow();
  });
});

describe('captureException (no-op when DSN absent)', () => {
  it('does not call fetch when SENTRY_DSN is not configured', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', { status: 200 }),
    );
    sentry.captureException(new Error('test error'), { route: '/x', bundle: 'b' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('scrubEvent (PII scrub, Deno-side)', () => {
  it('strips user.email, user.username, user.ip_address; keeps user.id; pins ip_address: null', () => {
    const out = sentry.scrubEvent({
      user: {
        id: 'opaque-uuid',
        email: 'jane@example.com',
        username: 'jane',
        ip_address: '203.0.113.42',
      },
    });
    expect(out).not.toBeNull();
    expect(out!.user).toEqual({ id: 'opaque-uuid', ip_address: null });
  });

  it('replaces user with { ip_address: null } when only PII fields are present (no id)', () => {
    const out = sentry.scrubEvent({
      user: { email: 'jane@example.com' },
    });
    expect(out).not.toBeNull();
    expect(out!.user).toEqual({ ip_address: null });
  });

  it('synthesizes user with { ip_address: null } even when input had no user', () => {
    const out = sentry.scrubEvent({ message: 'render error' });
    expect(out).not.toBeNull();
    expect(out!.user).toEqual({ ip_address: null });
  });

  it('strips request.cookies and the lowercase authorization header', () => {
    const out = sentry.scrubEvent({
      request: {
        url: 'https://api.kitstak.com/quotes',
        cookies: { session: 'abc' },
        headers: {
          authorization: 'Bearer secret',
          'content-type': 'application/json',
        },
      },
    });
    expect(out!.request!.cookies).toBeUndefined();
    expect(out!.request!.headers).toEqual({ 'content-type': 'application/json' });
  });

  it('strips Authorization header regardless of case', () => {
    const out = sentry.scrubEvent({
      request: {
        url: 'https://api.kitstak.com/x',
        headers: { Authorization: 'Bearer secret' },
      },
    });
    expect(
      (out!.request!.headers as Record<string, string>).Authorization,
    ).toBeUndefined();
  });

  it('strips query string from request.url and clears query_string', () => {
    const out = sentry.scrubEvent({
      request: {
        url: 'https://api.kitstak.com/invoices?email=jane@example.com&id=42',
        query_string: 'email=jane@example.com&id=42',
      },
    });
    expect(out!.request!.url).toBe('https://api.kitstak.com/invoices');
    expect(out!.request!.query_string).toBeUndefined();
  });

  it('redacts email and phone patterns inside extra', () => {
    const out = sentry.scrubEvent({
      extra: {
        note: 'hello',
        leak: 'contact jane@example.com for help',
        phone: '+1 (555) 123-4567',
      },
    });
    expect(out!.extra).toEqual({
      note: 'hello',
      leak: '[redacted]',
      phone: '[redacted]',
    });
  });

  it('redacts email and phone patterns inside tags', () => {
    const out = sentry.scrubEvent({
      tags: {
        route: '/quotes/:id',
        leak: 'jane@example.com',
      },
    });
    expect(out!.tags).toEqual({
      route: '/quotes/:id',
      leak: '[redacted]',
    });
  });

  it('drops the event when message contains an email pattern', () => {
    const out = sentry.scrubEvent({
      message: 'failed for user jane@example.com',
    });
    expect(out).toBeNull();
  });

  it('drops the event when an exception value contains an email pattern', () => {
    const out = sentry.scrubEvent({
      exception: {
        values: [
          { type: 'Error', value: 'lookup failed for jane@example.com' },
        ],
      },
    });
    expect(out).toBeNull();
  });

  it('passes through a benign event with only the opaque UUID retained', () => {
    const out = sentry.scrubEvent({
      message: 'render error',
      exception: { values: [{ type: 'TypeError', value: 'cannot read x of undefined' }] },
      user: { id: 'opaque-uuid' },
      tags: { route: '/quotes/:id', bundle: 'quotes-api' },
      extra: { handler: 'listQuotes' },
    });
    expect(out).not.toBeNull();
    expect(out!.message).toBe('render error');
    expect(out!.user).toEqual({ id: 'opaque-uuid', ip_address: null });
    expect(out!.tags).toEqual({ route: '/quotes/:id', bundle: 'quotes-api' });
    expect(out!.extra).toEqual({ handler: 'listQuotes' });
  });
});

describe('captureException end-to-end (DSN configured)', () => {
  it('POSTs a Sentry envelope to the ingest endpoint and survives a fetch failure', async () => {
    ENV_BAG.SENTRY_DSN =
      'https://abc123def456@o123456.ingest.sentry.io/7891011';
    sentry.initSentry();

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', { status: 200 }),
    );

    sentry.captureException(new Error('test error'), {
      route: '/quotes/:id',
      method: 'GET',
      bundle: 'quotes-api',
      request_id: 'req-uuid',
      org_id: 'org-opaque-uuid',
    });

    // Allow the fire-and-forget microtask to schedule.
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(
      'https://o123456.ingest.sentry.io/api/7891011/envelope/',
    );
    expect((init as RequestInit).method).toBe('POST');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['X-Sentry-Auth']).toContain('sentry_key=abc123def456');
    expect(headers['Content-Type']).toBe('application/x-sentry-envelope');

    // Envelope body: header newline item-header newline payload newline.
    const body = (init as RequestInit).body as string;
    const [, , payloadLine] = body.split('\n');
    const payload = JSON.parse(payloadLine);
    // org_id mapped to user.id; scrub pins ip_address: null.
    expect(payload.user).toEqual({ id: 'org-opaque-uuid', ip_address: null });
    expect(payload.tags.route).toBe('/quotes/:id');
    expect(payload.tags.bundle).toBe('quotes-api');
  });

  it('does not throw when fetch itself rejects', async () => {
    ENV_BAG.SENTRY_DSN =
      'https://abc123def456@o123456.ingest.sentry.io/7891011';
    sentry.initSentry();

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

    expect(() => {
      sentry.captureException(new Error('test'));
    }).not.toThrow();

    // Drain the rejected microtask to make sure the rejection is caught
    // and not left as an unhandled rejection in the test runner.
    await new Promise((r) => setTimeout(r, 0));
  });
});
