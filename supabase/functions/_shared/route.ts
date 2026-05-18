// Table-driven router for Edge Function bundles.
//
// Bundles declare a flat array of `{ method, path, handler }`. The dispatcher:
//   1. Strips the Supabase prefix (`/functions/v1/<bundle>`) and the bare
//      `/<bundle>` prefix so handlers see paths rooted at `/`.
//   2. Honors `opts.stripPrefix` so one bundle can mount under multiple
//      external prefixes (e.g. a future portal bundle).
//   3. Matches method + path (with `:param` slots). 405 on path-match-only,
//      404 on no match.
//   4. Catches ApiError and returns the canonical error envelope. Catches
//      everything else and returns INTERNAL_ERROR 500.
//   5. Echoes `x-request-id` if the caller supplied one, mints a fresh
//      UUID v4 otherwise.

import { ApiError, fromApiError } from './responses.ts';
import { handlePreflight } from './cors.ts';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface RouteCtx {
  req: Request;
  url: URL;
  params: Record<string, string>;
  bundle: string;
  requestId: string;
}

export interface Route {
  method: HttpMethod;
  path: string; // e.g. '/' or '/customers/:id'
  handler: (ctx: RouteCtx) => Promise<Response> | Response;
}

export interface RouteOptions {
  bundle: string;
  /**
   * Optional path prefix to strip before matching. Use when a bundle mounts
   * under multiple external paths (e.g. portal bundle handling both
   * `/portal/customer/*` and `/portal/vendor/*` via separate registrations).
   * Leading slash optional; trailing slash stripped.
   */
  stripPrefix?: string;
}

function normalize(path: string): string {
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path;
}

function matchPath(
  pattern: string,
  actual: string,
): Record<string, string> | null {
  const p = normalize(pattern).split('/');
  const a = normalize(actual).split('/');
  if (p.length !== a.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    const seg = p[i];
    if (seg.startsWith(':')) {
      params[seg.slice(1)] = decodeURIComponent(a[i]);
    } else if (seg !== a[i]) {
      return null;
    }
  }
  return params;
}

function bundlePath(url: URL, bundle: string, stripPrefix?: string): string {
  let full = url.pathname;
  const v1 = `/functions/v1/${bundle}`;
  if (full.startsWith(v1)) {
    full = full.slice(v1.length) || '/';
  } else {
    const bare = `/${bundle}`;
    if (full === bare || full.startsWith(bare + '/')) {
      full = full.slice(bare.length) || '/';
    }
  }
  if (stripPrefix) {
    const prefix = stripPrefix.startsWith('/')
      ? stripPrefix
      : `/${stripPrefix}`;
    const trimmed = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
    if (full === trimmed || full.startsWith(trimmed + '/')) {
      full = full.slice(trimmed.length) || '/';
    }
  }
  return normalize(full || '/');
}

/**
 * Attach `x-request-id` to a response. Preserves the body and status; only
 * adds the header if missing. Used after a handler returns so the caller can
 * correlate logs.
 */
function withRequestId(response: Response, requestId: string): Response {
  if (response.headers.has('x-request-id')) return response;
  const headers = new Headers(response.headers);
  headers.set('x-request-id', requestId);
  return new Response(response.body, {
    status: response.status,
    headers,
  });
}

/**
 * Dispatch a request against a route table. Wraps the entire flow in the
 * canonical error envelope. CORS preflight is handled inline; OPTIONS
 * requests never reach the route table.
 */
export async function route(
  req: Request,
  table: Route[],
  opts: RouteOptions,
): Promise<Response> {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const requestId =
    req.headers.get('x-request-id') ?? crypto.randomUUID();
  const url = new URL(req.url);
  const path = bundlePath(url, opts.bundle, opts.stripPrefix);

  try {
    let methodMatched = false;
    for (const r of table) {
      const params = matchPath(r.path, path);
      if (params === null) continue;
      if (r.method !== req.method) {
        methodMatched = true;
        continue;
      }
      const ctx: RouteCtx = {
        req,
        url,
        params,
        bundle: opts.bundle,
        requestId,
      };
      const response = await r.handler(ctx);
      return withRequestId(response, requestId);
    }

    if (methodMatched) {
      return withRequestId(
        fromApiError(new ApiError('METHOD_NOT_ALLOWED', 405)),
        requestId,
      );
    }
    return withRequestId(
      fromApiError(new ApiError('NOT_FOUND', 404)),
      requestId,
    );
  } catch (err) {
    if (err instanceof ApiError) {
      return withRequestId(fromApiError(err), requestId);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error('unhandled error in route dispatch', {
      bundle: opts.bundle,
      path,
      request_id: requestId,
      message,
    });
    return withRequestId(
      fromApiError(new ApiError('INTERNAL_ERROR', 500, message)),
      requestId,
    );
  }
}
