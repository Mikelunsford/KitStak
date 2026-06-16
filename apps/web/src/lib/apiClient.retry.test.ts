// R-W13-UX-03(a) regression: the single fetch wrapper auto-retries transient
// failures while reusing the SAME Idempotency-Key so a non-GET retry can never
// double-apply (the server idempotency contract dedupes the replayed key).
//
// These tests drive `executeRequest` directly with an injected `fetch` stub so
// they exercise the retry contract without a network or a Supabase session.
// They assert the two safety properties of the design:
//   1. The replayed attempt carries the identical Idempotency-Key header.
//   2. A 4xx is never retried (deterministic client error).

import { describe, it, expect, vi } from 'vitest';

import { executeRequest, ApiError, type FetchImpl } from './apiClient.core';
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
