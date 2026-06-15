// Cross-boundary string-literal canon.
//
// Single source of truth for string literals that flow across the SPA <-> Edge
// Function boundary: feature-flag keys, HTTP header names, error codes. Any
// literal whose value MUST match between a writer site and a reader site lives
// here and is consumed by named import.
//
// Why this exists
// ---------------
// F-Wave6-CORS-01 and G-OPS-FLAG-01 were both drift bugs of the same shape:
// the same wire string was typed independently in two files, the two copies
// drifted, and the system silently broke for months. Canonicalising the
// literal at a single named-import site removes the drift surface.
//
// Mirror parity
// -------------
// `apps/web/src/lib/constants.ts` is byte-identical to this file and is
// enforced by `pnpm test:contract` (test/contract/parity.test.ts). Any change
// to one MUST be copied verbatim to the other in the same commit.
//
// Out of scope
// ------------
// - Within-bundle literals (e.g. a single handler's own state-name enum).
// - SQL migration bodies. SQL cannot import from TS; the seed-org-settings
//   migration carries an inline comment pointing back here.
// - Status codes (lives in responses.ts STATUS_FOR_CODE, since the SPA only
//   reads response.status from fetch, not a literal).

/**
 * Feature-flag keys. Dot-namespaced `<domain>.<feature>[.<sub>]` strings
 * stored in `public.org_feature_flags(flag_key)` and read by `getFlag()`.
 * Pillar plugins gate at the bundle level (404 when off); per-route flags
 * return 403 FEATURE_DISABLED with `details.flag` carrying this string.
 */
export const FEATURE_FLAGS = {
  // Pillar plugins (bundle-level 404 gates).
  PLUGINS_THREE_PL: 'plugins.three_pl',
  PLUGINS_MANUFACTURING: 'plugins.manufacturing',
  PLUGINS_COPACK_ECOM: 'plugins.copack_ecom',
  PLUGINS_KITFORCE: 'plugins.kitforce',
  PLUGINS_KITCOST: 'plugins.kitcost',
  PLUGINS_WMS: 'plugins.wms',
  // Add-ons.
  ADDONS_WHITELABEL: 'addons.whitelabel',
  ADDONS_KITFORCE: 'addons.kitforce',
  ADDONS_KITCOST: 'addons.kitcost',
  // Finance (per-route gates).
  FINANCE_JOURNAL_ENTRIES_ENABLED: 'finance.journal_entries.enabled',
  // Auth.
  AUTH_SSO_SAML: 'auth.sso_saml',
  // Platform admin (bundle-level 404 gate for admin-console-api).
  PLATFORM_ADMIN_ENABLED: 'platform_admin.enabled',
} as const;

export type FeatureFlagKey =
  (typeof FEATURE_FLAGS)[keyof typeof FEATURE_FLAGS];

/**
 * Paid pillar plugin flags. Enabling any of these (is_enabled = true) on an
 * org requires an active billing subscription. The settings-api flag-write
 * handler checks the org's `subscription_status` before honouring an enable
 * and returns `403 BILLING_REQUIRED` when the org is not on an active or
 * trialing plan. Disabling a plugin is always allowed.
 *
 * This entitlement gate is distinct from the bundle gate: bundle-gate misses
 * stay `404 NOT_FOUND` (a tenant on a sub-plan cannot enumerate the surface),
 * while this `403` is a flag-write denial on the settings surface the caller
 * already legitimately reaches.
 */
export const PAID_PLUGIN_FLAGS: ReadonlySet<string> = new Set<string>([
  FEATURE_FLAGS.PLUGINS_THREE_PL,
  FEATURE_FLAGS.PLUGINS_MANUFACTURING,
  FEATURE_FLAGS.PLUGINS_COPACK_ECOM,
  FEATURE_FLAGS.PLUGINS_KITFORCE,
  FEATURE_FLAGS.PLUGINS_KITCOST,
  FEATURE_FLAGS.PLUGINS_WMS,
]);

/**
 * HTTP header names. Centralised so the CORS allow-list, the
 * idempotency reader, the worker-secret check, and the SPA apiClient writer
 * cannot drift. Values are the wire-format header names (lower-cased per
 * RFC 7230 §3.2 normalization; `req.headers.get()` is case-insensitive but
 * the CORS `Access-Control-Allow-Headers` list MUST match what the SPA
 * actually sends).
 */
export const HTTP_HEADERS = {
  API_KEY: 'apikey',
  AUTHORIZATION: 'authorization',
  CONTENT_TYPE: 'content-type',
  IDEMPOTENCY_KEY: 'idempotency-key',
  X_REQUEST_ID: 'x-request-id',
  X_WORKER_SECRET: 'x-worker-secret',
  IDEMPOTENT_REPLAY: 'idempotent-replay',
  RETRY_AFTER: 'retry-after',
} as const;

export type HttpHeaderName =
  (typeof HTTP_HEADERS)[keyof typeof HTTP_HEADERS];

/**
 * Error envelope codes. Emitted by the BE via `new ApiError(code, ...)` and
 * compared by the SPA via `err.code === ...`. Status mapping lives in
 * responses.ts STATUS_FOR_CODE.
 *
 * Adding a new code: append here, add the status mapping to responses.ts,
 * and widen the `ApiErrorCode` union in `_shared/responses.ts`.
 */
export const ERROR_CODES = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  NO_ACTIVE_ORG: 'NO_ACTIVE_ORG',
  FORBIDDEN: 'FORBIDDEN',
  FEATURE_DISABLED: 'FEATURE_DISABLED',
  NOT_FOUND: 'NOT_FOUND',
  METHOD_NOT_ALLOWED: 'METHOD_NOT_ALLOWED',
  STATE_CONFLICT: 'STATE_CONFLICT',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  IDEMPOTENCY_KEY_REQUIRED: 'IDEMPOTENCY_KEY_REQUIRED',
  IDEMPOTENCY_INVALID_KEY: 'IDEMPOTENCY_INVALID_KEY',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  BILLING_REQUIRED: 'BILLING_REQUIRED',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
