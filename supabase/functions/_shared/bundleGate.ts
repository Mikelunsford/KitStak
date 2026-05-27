// Plugin bundle gate.
//
// Constitutional rule (CLAUDE.md, 00-canon/01-architecture.md):
//   Plugin bundle gates return 404 NOT_FOUND. The entire Edge function
//   bundle is hidden when the pillar plugin flag is off for the caller's
//   org. Every method, every path, returns the same 404 envelope so a
//   tenant on a sub-plan cannot enumerate the surface.
//
//   This is distinct from per-route feature flag misses, which return
//   `403 FEATURE_DISABLED { flag }` via `requireFlag` / `withFlag`. A
//   403 where a 404 is expected is a release blocker.
//
// Helper shape: `serveWithBundleGate(flagKey, table, bundleName)` wraps
// the bundle's `Deno.serve` registration so the dispatcher reads the
// plugin flag once per request before the route table runs. Org-less
// callers fall through to the standard `requireCaller` UNAUTHORIZED /
// NO_ACTIVE_ORG envelope from inside `route()`; the gate only fires
// once an org claim is resolvable.
//
// CORS preflight (`OPTIONS`) bypasses the gate: a preflight that 404'd
// would deny the SPA a chance to learn that an authenticated request
// would also 404, hiding the surface from the browser CORS check
// rather than from the caller. The preflight returns the standard
// `Access-Control-Allow-*` envelope from `route()`.

import { route, type Route } from './route.ts';
import { ApiError, fromApiError } from './responses.ts';
import { getFlag } from './feature-flags.ts';
import { readCallerContext } from './tenant.ts';
import { ERROR_CODES } from './constants.ts';

export interface BundleGateOptions {
  /** Plugin flag key, e.g. FEATURE_FLAGS.PLUGINS_THREE_PL. */
  flagKey: string;
  /** Route table to dispatch when the gate passes. */
  routes: Route[];
  /** Bundle name forwarded to `route()` for logging and idempotency keys. */
  bundle: string;
}

/**
 * Register a `Deno.serve` handler that gates the entire bundle on a
 * pillar plugin flag. When the flag is off the dispatcher returns a
 * 404 NOT_FOUND envelope before any route runs.
 *
 * Use this from a bundle's `index.ts` instead of calling `Deno.serve`
 * directly:
 *
 *   serveBundleWithGate({
 *     flagKey: FEATURE_FLAGS.PLUGINS_THREE_PL,
 *     routes: ROUTES,
 *     bundle: 'quotes-api',
 *   });
 */
export function serveBundleWithGate(opts: BundleGateOptions): void {
  Deno.serve((req: Request) => bundleGateDispatch(req, opts));
}

/**
 * The dispatcher body, exported for unit tests that need to invoke the
 * gate without binding to a port. Identical semantics to the body inside
 * `serveBundleWithGate`'s `Deno.serve` callback.
 */
export async function bundleGateDispatch(
  req: Request,
  opts: BundleGateOptions,
): Promise<Response> {
  // CORS preflight always passes the gate so the browser learns about
  // the surface's allowed methods + headers. The preflight envelope
  // does not leak whether the caller is entitled.
  if (req.method === 'OPTIONS') {
    return route(req, [], { bundle: opts.bundle });
  }

  // Lenient claim read. Callers without an org claim fall through to
  // the standard UNAUTHORIZED / NO_ACTIVE_ORG envelope from
  // requireCaller inside the route table. The gate only fires once an
  // org claim is resolvable so an anonymous probe cannot infer flag
  // state from the response.
  const ctx = readCallerContext(req);
  if (ctx.orgId) {
    const flag = await getFlag(ctx.orgId, opts.flagKey);
    if (!flag.enabled) {
      return fromApiError(new ApiError(ERROR_CODES.NOT_FOUND, 404));
    }
  }

  return route(req, opts.routes, { bundle: opts.bundle });
}
