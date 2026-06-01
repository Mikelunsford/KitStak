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
// Helper shape: `serveBundleWithGate(opts)` wraps the bundle's
// `Deno.serve` registration so the dispatcher reads the plugin flag(s)
// once per request before the route table runs. Org-less callers fall
// through to the standard `requireCaller` UNAUTHORIZED / NO_ACTIVE_ORG
// envelope from inside `route()`; the gate only fires once an org claim
// is resolvable.
//
// Single-flag vs OR predicate
// ---------------------------
// Most pillar bundles gate on exactly one plugin flag (`flagKey`): the
// surface belongs to a single pillar and is hidden unless that pillar's
// plugin is enabled (ops-api, manufacturing-api, quotes-api, ...).
//
// Some surfaces are CROSS-PILLAR. customers/contacts/leads (crm-api) and
// taxes/items/payment-methods/pricing-tiers (sales-config-api) are read
// and written from the 3PL, Manufacturing, and Co-Pack pillars alike. A
// manufacturing-only org legitimately needs customers and items, so
// gating those bundles on a single `plugins.three_pl` flag would lock
// them out. For these the gate takes `flagKeys: string[]` (an OR / anyOf
// predicate): the bundle is reachable when ANY listed flag is enabled,
// and only returns 404 when ALL of them are off.
//
// Exactly one of `flagKey` or `flagKeys` must be supplied. Supplying
// both, neither, or an empty `flagKeys` array is a configuration error
// and the gate fails closed (404) so a mistake never silently exposes a
// bundle.
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
  /**
   * Single plugin flag key, e.g. FEATURE_FLAGS.PLUGINS_THREE_PL. The
   * bundle is hidden (404) unless this one flag is enabled. Use this for
   * single-pillar bundles. Mutually exclusive with `flagKeys`.
   */
  flagKey?: string;
  /**
   * OR / anyOf predicate. The bundle is reachable when ANY listed flag
   * is enabled, and returns 404 only when ALL are off. Use this for
   * cross-pillar surfaces (crm-api, sales-config-api). Mutually
   * exclusive with `flagKey`. An empty array fails closed (404).
   */
  flagKeys?: readonly string[];
  /** Route table to dispatch when the gate passes. */
  routes: Route[];
  /** Bundle name forwarded to `route()` for logging and idempotency keys. */
  bundle: string;
}

/**
 * Normalize the gate predicate to a flag list. Returns `null` for a
 * misconfiguration (both `flagKey` and `flagKeys`, neither, or an empty
 * `flagKeys` array) so the dispatcher can fail closed rather than serve
 * an ungated bundle. Back-compat: a lone `flagKey` resolves to a
 * single-element list, preserving the original single-flag behaviour.
 */
function resolveGateFlags(opts: BundleGateOptions): readonly string[] | null {
  const hasSingle = opts.flagKey !== undefined;
  const hasMany = opts.flagKeys !== undefined;
  if (hasSingle === hasMany) {
    // Both supplied or neither supplied: configuration error.
    return null;
  }
  if (hasSingle) {
    return [opts.flagKey as string];
  }
  const many = opts.flagKeys as readonly string[];
  if (many.length === 0) return null;
  return many;
}

/**
 * Resolve whether the caller's org passes the gate. Reads each flag in
 * order and short-circuits on the first enabled one, so the common case
 * (first flag on) costs a single flag read. `getFlag` is independently
 * memoized for 5 minutes per (org_id, flag_key).
 */
async function anyFlagEnabled(
  orgId: string,
  flagKeys: readonly string[],
): Promise<boolean> {
  for (const flagKey of flagKeys) {
    const flag = await getFlag(orgId, flagKey);
    if (flag.enabled) return true;
  }
  return false;
}

/**
 * Register a `Deno.serve` handler that gates the entire bundle on one or
 * more pillar plugin flags. When the gate fails the dispatcher returns a
 * 404 NOT_FOUND envelope before any route runs.
 *
 * Single-pillar bundle (one flag must be on):
 *
 *   serveBundleWithGate({
 *     flagKey: FEATURE_FLAGS.PLUGINS_THREE_PL,
 *     routes: ROUTES,
 *     bundle: 'quotes-api',
 *   });
 *
 * Cross-pillar bundle (any listed flag may be on):
 *
 *   serveBundleWithGate({
 *     flagKeys: [
 *       FEATURE_FLAGS.PLUGINS_THREE_PL,
 *       FEATURE_FLAGS.PLUGINS_MANUFACTURING,
 *       FEATURE_FLAGS.PLUGINS_COPACK_ECOM,
 *     ],
 *     routes: ROUTES,
 *     bundle: 'crm-api',
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

  const flagKeys = resolveGateFlags(opts);
  // Misconfiguration: fail closed so an ungated bundle is never served.
  if (flagKeys === null) {
    return fromApiError(new ApiError(ERROR_CODES.NOT_FOUND, 404));
  }

  // Lenient claim read. Callers without an org claim fall through to
  // the standard UNAUTHORIZED / NO_ACTIVE_ORG envelope from
  // requireCaller inside the route table. The gate only fires once an
  // org claim is resolvable so an anonymous probe cannot infer flag
  // state from the response.
  const ctx = readCallerContext(req);
  if (ctx.orgId) {
    const passed = await anyFlagEnabled(ctx.orgId, flagKeys);
    if (!passed) {
      return fromApiError(new ApiError(ERROR_CODES.NOT_FOUND, 404));
    }
  }

  return route(req, opts.routes, { bundle: opts.bundle });
}
