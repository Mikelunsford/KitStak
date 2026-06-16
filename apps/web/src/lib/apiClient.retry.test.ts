// R-W13-UX-03(a) regression: the single fetch wrapper auto-retries transient
// failures while reusing the SAME Idempotency-Key so a non-GET retry can never
// double-apply (the server idempotency contract dedupes the replayed key).
//
// These tests drive `executeRequest` directly with an injected `fetch` stub so
// they exercise the retry contract without a network or a Supabase session.
// They assert the two safety properties of the design:
//   1. The replayed attempt carries the identical Idempotency-Key header.
//   2. A non-429 4xx is never retried (deterministic client error).
//
// F-Wave13-RETRY-AFTER-429-01 extends this: a 429 IS retried, but only after
// waiting out the server Retry-After (capped), still reusing the same key. The
// 429 tests inject a `sleep` stub so they exercise the backoff without a timer.

import { describe, it, expect, vi } from 'vitest';

import {
  executeRequest,
  ApiError,
  parseRetryAfterMs,
  retryAfterDelayMs,
  RETRY_AFTER_DEFAULT_MS,
  RETRY_AFTER_MAX_MS,
  type FetchImpl,
} from './apiClient.core';
import { HTTP_HEADERS } from './constants';

function okResponse(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function errorResponse(status: number, code: string, message: string): Response {
  return new Response(
    JSON.stringify({ error: { code, message } }),
    { status, headers: { 'content-type': 'application/json' } },
  );
}

function rateLimited(retryAfter?: string): Response {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (retryAfter !== undefined) headers[HTTP_HEADERS.RETRY_AFTER] = retryAfter;
  return new Response(
    JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'slow down' } }),
    { status: 429, headers },
  );
}

const IDEMPOTENCY_KEY = '11111111-1111-4111-8111-111111111111';

function nonGetInit(): RequestInit {
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [HTTP_HEADERS.IDEMPOTENCY_KEY]: IDEMPOTENCY_KEY,
    },
    body: JSON.stringify({ name: 'Cash' }),
  };
}

function keyOf(init: RequestInit): string | undefined {
  const headers = init.headers as Record<string, string> | undefined;
  return headers?.[HTTP_HEADERS.IDEMPOTENCY_KEY];
}

/**
 * Build a spy-able FetchImpl from a plain async impl. Returns the spy so tests
 * can assert call counts while keeping the typed FetchImpl signature.
 */
function spyFetch(impl: FetchImpl) {
  return vi.fn(impl);
}

describe('executeRequest transient auto-retry', () => {
  it('retries once on a thrown network failure and reuses the same Idempotency-Key', async () => {
    const seenKeys: Array<string | undefined> = [];
    const fetchImpl = spyFetch(async (_url, init) => {
      seenKeys.push(keyOf(init));
      if (seenKeys.length === 1) {
        throw new TypeError('Failed to fetch');
      }
      return okResponse({ id: 'coa_1' });
    });

    const result = await executeRequest<{ id: string }>(
      'https://example.test/coa',
      nonGetInit(),
      fetchImpl,
    );

    expect(result).toEqual({ id: 'coa_1' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // The retry MUST carry the identical key so the server dedupes it.
    expect(seenKeys).toEqual([IDEMPOTENCY_KEY, IDEMPOTENCY_KEY]);
    expect(new Set(seenKeys).size).toBe(1);
  });

  it('retries once on a 5xx and reuses the same Idempotency-Key', async () => {
    const seenKeys: Array<string | undefined> = [];
    const fetchImpl = spyFetch(async (_url, init) => {
      seenKeys.push(keyOf(init));
      if (seenKeys.length === 1) {
        return errorResponse(503, 'INTERNAL_ERROR', 'upstream down');
      }
      return okResponse({ id: 'coa_2' });
    });

    const result = await executeRequest<{ id: string }>(
      'https://example.test/coa',
      nonGetInit(),
      fetchImpl,
    );

    expect(result).toEqual({ id: 'coa_2' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(seenKeys).toEqual([IDEMPOTENCY_KEY, IDEMPOTENCY_KEY]);
  });

  it('does not retry on a 4xx and surfaces the ApiError from the first response', async () => {
    const fetchImpl = spyFetch(async () =>
      errorResponse(409, 'IDEMPOTENCY_CONFLICT', 'same key, different body'),
    );

    await expect(
      executeRequest('https://example.test/coa', nonGetInit(), fetchImpl),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', status: 409 });

    // 4xx is deterministic: exactly one attempt, no replay.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not retry on a validation 400', async () => {
    const fetchImpl = spyFetch(async () =>
      errorResponse(400, 'VALIDATION_ERROR', 'name is required'),
    );

    await expect(
      executeRequest('https://example.test/coa', nonGetInit(), fetchImpl),
    ).rejects.toBeInstanceOf(ApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('exhausts the bounded budget: a persistent network failure throws after one retry', async () => {
    const fetchImpl = spyFetch(async () => {
      throw new TypeError('Failed to fetch');
    });

    await expect(
      executeRequest('https://example.test/coa', nonGetInit(), fetchImpl),
    ).rejects.toBeInstanceOf(TypeError);

    // First attempt + exactly one retry = 2 calls, then it gives up.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry a successful first response', async () => {
    const fetchImpl = spyFetch(async () => okResponse({ id: 'coa_ok' }));

    const result = await executeRequest<{ id: string }>(
      'https://example.test/coa',
      nonGetInit(),
      fetchImpl,
    );

    expect(result).toEqual({ id: 'coa_ok' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not double-apply: a single logical POST yields at most one successful write attempt', async () => {
    // Model an idempotent server: the first attempt actually writes but the
    // response is lost (network drop after commit); the retry replays the same
    // key and the server returns the stored result instead of writing again.
    let writes = 0;
    const fetchImpl = spyFetch(async (_url, init) => {
      const key = keyOf(init);
      // Server keys its dedupe on the Idempotency-Key. Same key -> same row.
      if (key === IDEMPOTENCY_KEY && writes === 0) {
        writes += 1;
        // The write committed, but the response never reached the client.
        throw new TypeError('socket closed after commit');
      }
      // Replay with the same key returns the stored result, no new write.
      return okResponse({ id: 'coa_dedup', replayed: true });
    });

    const result = await executeRequest<{ id: string; replayed: boolean }>(
      'https://example.test/coa',
      nonGetInit(),
      fetchImpl,
    );

    expect(result).toEqual({ id: 'coa_dedup', replayed: true });
    expect(writes).toBe(1); // exactly one write despite the retry
  });
});

describe('executeRequest 429 Retry-After backoff', () => {
  it('retries a 429 once, waits the Retry-After seconds, and reuses the same Idempotency-Key', async () => {
    const seenKeys: Array<string | undefined> = [];
    const slept: number[] = [];
    const sleep = vi.fn(async (ms: number) => { slept.push(ms); });
    const fetchImpl = spyFetch(async (_url, init) => {
      seenKeys.push(keyOf(init));
      if (seenKeys.length === 1) return rateLimited('2');
      return okResponse({ id: 'coa_429' });
    });

    const result = await executeRequest<{ id: string }>(
      'https://example.test/coa',
      nonGetInit(),
      fetchImpl,
      1,
      sleep,
    );

    expect(result).toEqual({ id: 'coa_429' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(slept).toEqual([2000]); // honored the Retry-After: 2s
    // The replay MUST carry the identical key so the server dedupes it.
    expect(seenKeys).toEqual([IDEMPOTENCY_KEY, IDEMPOTENCY_KEY]);
  });

  it('falls back to the default wait when a 429 carries no Retry-After', async () => {
    const slept: number[] = [];
    const sleep = vi.fn(async (ms: number) => { slept.push(ms); });
    let calls = 0;
    const fetchImpl = spyFetch(async () => {
      calls += 1;
      return calls === 1 ? rateLimited() : okResponse({ id: 'coa_def' });
    });

    await executeRequest('https://example.test/coa', nonGetInit(), fetchImpl, 1, sleep);
    expect(slept).toEqual([RETRY_AFTER_DEFAULT_MS]);
  });

  it('honors a 0-second Retry-After as an immediate replay', async () => {
    const slept: number[] = [];
    const sleep = vi.fn(async (ms: number) => { slept.push(ms); });
    let calls = 0;
    const fetchImpl = spyFetch(async () => {
      calls += 1;
      return calls === 1 ? rateLimited('0') : okResponse({ id: 'coa_now' });
    });

    const result = await executeRequest<{ id: string }>(
      'https://example.test/coa',
      nonGetInit(),
      fetchImpl,
      1,
      sleep,
    );

    expect(result).toEqual({ id: 'coa_now' });
    expect(slept).toEqual([0]); // server said retry now: wait 0, still backed off through sleep()
  });

  it('caps an oversized Retry-After at the max wait', async () => {
    const slept: number[] = [];
    const sleep = vi.fn(async (ms: number) => { slept.push(ms); });
    let calls = 0;
    const fetchImpl = spyFetch(async () => {
      calls += 1;
      return calls === 1 ? rateLimited('999999') : okResponse({ id: 'coa_cap' });
    });

    await executeRequest('https://example.test/coa', nonGetInit(), fetchImpl, 1, sleep);
    expect(slept).toEqual([RETRY_AFTER_MAX_MS]);
  });

  it('surfaces RATE_LIMITED after the bounded budget is exhausted, waiting before the replay', async () => {
    const slept: number[] = [];
    const sleep = vi.fn(async (ms: number) => { slept.push(ms); });
    const fetchImpl = spyFetch(async () => rateLimited('1'));

    await expect(
      executeRequest('https://example.test/coa', nonGetInit(), fetchImpl, 1, sleep),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 });

    // attempt 0 (429 -> wait -> replay) + attempt 1 (429, budget gone -> throw)
    // = 2 fetches and exactly one backoff.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(slept).toEqual([1000]);
  });
});

describe('parseRetryAfterMs / retryAfterDelayMs', () => {
  // 1_700_000_000_000 ms sits on an exact second boundary so the HTTP-date
  // round-trip (toUTCString drops sub-second precision) is lossless.
  const NOW = 1_700_000_000_000;

  it('parses delay-seconds into milliseconds', () => {
    expect(parseRetryAfterMs('5', NOW)).toBe(5000);
    expect(parseRetryAfterMs('0', NOW)).toBe(0);
    expect(parseRetryAfterMs('  3  ', NOW)).toBe(3000); // tolerant of surrounding space
  });

  it('parses an HTTP-date relative to now and never returns negative', () => {
    const tenSecondsOut = new Date(NOW + 10_000).toUTCString();
    expect(parseRetryAfterMs(tenSecondsOut, NOW)).toBe(10_000);
    const pastDate = new Date(NOW - 10_000).toUTCString();
    expect(parseRetryAfterMs(pastDate, NOW)).toBe(0);
  });

  it('returns null for a missing, empty, or unparseable value so the caller can default', () => {
    expect(parseRetryAfterMs(null, NOW)).toBeNull();
    expect(parseRetryAfterMs('', NOW)).toBeNull();
    expect(parseRetryAfterMs('soon', NOW)).toBeNull();
  });

  it('rejects a malformed numeric delay-seconds (fraction or sign) so it cannot misparse as a date', () => {
    // A fraction is not a valid delay-seconds; rejecting it means the caller
    // falls back to the default backoff instead of a Date.parse("1.5") -> 0ms wait.
    expect(parseRetryAfterMs('1.5', NOW)).toBeNull();
    expect(parseRetryAfterMs('-3', NOW)).toBeNull();
    expect(retryAfterDelayMs('1.5', NOW)).toBe(RETRY_AFTER_DEFAULT_MS);
  });

  it('retryAfterDelayMs defaults when absent and caps when oversized', () => {
    expect(retryAfterDelayMs(null, NOW)).toBe(RETRY_AFTER_DEFAULT_MS);
    expect(retryAfterDelayMs('999999', NOW)).toBe(RETRY_AFTER_MAX_MS);
    expect(retryAfterDelayMs('3', NOW)).toBe(3000);
  });
});
