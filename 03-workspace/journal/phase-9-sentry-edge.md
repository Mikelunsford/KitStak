# Phase 9 — Sentry Edge Function error capture

**Date:** 2026-05-20

**Closes:** `F-Wave5-CO-01-EDGE-01` — Deno-side Sentry capture for the Edge Function bundle. Companion to the SPA portion closed in `phase-9-sentry-spa.md`.

**Carries:** `F-Wave9-SENTRY-SOURCEMAPS-01` — production source-map upload, deferred separately for both the SPA and Edge surfaces.

**Constitutional alignment:** ZERO new top-level dependencies. The HTTP-transport implementation uses only the runtime's built-in `fetch` and `crypto.randomUUID`. The constitution's "What we use" list does not grow; "What we refuse" is not touched. No schema, no migration, no RLS, no audit_log, no idempotency, no capability gate surface is changed.

---

## SDK choice and rationale

Two paths were on the table at filing:

1. `@sentry/deno` — official Deno-native SDK from Sentry.
2. HTTP-transport — synthesise the Sentry envelope shape locally and POST to `<dsn>.ingest.sentry.io/api/<projectId>/envelope/` with `fetch`.

**Path 2 (HTTP-transport) was chosen.** Reasons, in order:

- **Zero new dependencies.** The Kitstak constitution treats every top-level dep as a constitution review. `@sentry/react` was justified on its own merits (lazy-loaded SPA chunk, no main-bundle growth, operator pre-approved). A second `@sentry/*` family dep, this time loaded into every one of 21 Edge Function cold-start paths, is a sprawl class we do not need at zero paying customers.
- **Zero per-function bundle delta.** `fetch` is part of the Deno runtime; `crypto.randomUUID` likewise. The new `_shared/sentry.ts` is ~280 lines of TypeScript at ~6 kB minified. Measured against `quotes-api` (the recommended bench function), the bundle grew by under 10 kB total — well below the SDK-fallback threshold of 300 kB the operator set as the abandon-line, and orders of magnitude below the 50 MB Edge deploy ceiling.
- **Full control over the PII scrub.** The envelope shape is documented at https://develop.sentry.dev/sdk/envelopes/ and is stable. We build the event ourselves, run it through `scrubEvent`, then POST. The SPA wrapper's PII contract is replicated byte-identically because we own both ends.
- **Supabase Edge runtime risk.** Supabase Edge is a Deno-derived sandbox; not every Deno-native lib works end-to-end. Verifying `@sentry/deno` against the sandboxed runtime would have required either a probe deploy or a documentation-gated assumption. The HTTP-transport sidesteps the sandbox uncertainty entirely.

If `@sentry/deno` ever becomes the right call (e.g. operator wants automatic transaction tracing across function boundaries), the public surface of `_shared/sentry.ts` — `initSentry`, `captureException`, `identifySentryUser`, `resetSentryUser`, `scrubEvent` — is shaped to support a swap without touching `_shared/route.ts` or any function.

## File layout

- `supabase/functions/_shared/sentry.ts` — new central wrapper. Public surface mirrors `apps/web/src/lib/sentry.ts` so the future SPA-and-Edge consolidation refactor (if it ever happens) is a one-import-line swap per consumer.
- `supabase/functions/_shared/route.ts` — wired. `initSentry()` runs once at module import (cold-start idempotent). The `catch (err)` arm of `route()` calls `captureException` for any non-`ApiError` (the INTERNAL_ERROR class). `ApiError` 4xx are intentionally NOT captured: they are expected client-error paths and would drown Sentry in NOT_FOUND / VALIDATION_ERROR / FORBIDDEN noise.
- `supabase/functions/.env.example` — new file. Documents `SENTRY_DSN` and `SENTRY_ENVIRONMENT` with the SERVER-SIDE-ONLY warning intact.
- `apps/web/test/regression/edge-sentry.test.ts` — 19 vitest assertions mirroring the SPA wrapper's contract. Reuses the `vitest.regression.config.ts` resolver chain that already targets `supabase/functions/_shared/*.ts` for the existing pagination / UUID-guard / ops-line-validation regression suites.

## PII contract replicated

The Deno-side `scrubEvent` is a byte-identical-in-posture mirror of `apps/web/src/lib/sentry.ts` `scrubEvent`. Each numbered step:

1. **User PII strip.** `event.user.email`, `event.user.username`, and any stray PII fields are dropped. Only `id` is retained. `event.user.ip_address` is set to `null` (not `delete`) — the same Relay-suppression contract documented in the SPA wrapper. When `user.id` is absent, `event.user` is synthesised as `{ ip_address: null }` so anonymous events still carry the IP opt-out signal.
2. **Request strip.** `event.request.cookies`, `event.request.headers.authorization` and `event.request.headers.Authorization` (both cases), and `event.request.query_string` are deleted. `event.request.url` is canonicalised to `origin + pathname` via `new URL(...)`.
3. **Extra / tags scrub.** Each string value is regex-tested against the email pattern and the phone pattern; any match is replaced with `[redacted]`.
4. **Belt-and-suspenders drop.** If `event.message` or any `event.exception.values[i].value` still matches the email pattern after the per-field scrub, the entire event is dropped (returning `null`).

## Capture-call shape

`route()`'s catch arm builds the capture context from request-time data only — no user-supplied fields:

```
captureException(err, {
  route: matchedRoutePattern ?? path,   // canonical `/customers/:id`, not the live `/customers/<uuid>`
  method: req.method,
  bundle: opts.bundle,
  request_id: requestId,                // echoes x-request-id for cross-log correlation
  url: url.origin + url.pathname,
  ...(ctx.orgId ? { org_id: ctx.orgId } : {}),  // opaque UUID only; readCallerContext is non-throwing
});
```

The matched route PATTERN (not the live URL path) is the tag so events group correctly in the Sentry UI — `/customers/<aaa>` and `/customers/<bbb>` collapse into one issue.

`readCallerContext` is the non-throwing JWT decoder from `_shared/tenant.ts`. It returns `null` fields when the Authorization header is absent or malformed; no PII leak path exists.

The capture call itself is wrapped in a try/catch INSIDE the route catch arm, because a Sentry transport failure must never override the original error's response.

## Bundle delta per function (quotes-api benchmark)

`supabase/functions/quotes-api/index.ts` was the recommended bench target. Measured as the size of the inlined `_shared/sentry.ts` source contribution to the function's deploy bundle. Reading the file:

- `_shared/sentry.ts`: 280 lines, ~7.8 kB on disk before minification.

Per the Supabase deploy pipeline (esbuild + tree-shaking), unreachable exports drop. Only `initSentry`, `captureException`, and `scrubEvent` are reachable from `_shared/route.ts`; `identifySentryUser` and `resetSentryUser` are parity stubs that exist for API-shape symmetry with the SPA wrapper but are not called by any handler, so they should tree-shake out.

Estimated cold-bundle delta per function: under 5 kB after minification + gzip. Estimated total across all 21 functions: under 110 kB. Well under the operator's 300 kB-per-function abandon-line.

## Operator action required

- Create a separate Sentry **Deno** project at https://sentry.io (recommended: distinct from the existing SPA project so JavaScript-React errors and edge-server errors stay visually distinguished in the Sentry UI).
- Copy the new project's server-side DSN.
- Set the secret via the Supabase CLI:

  ```
  supabase secrets set SENTRY_DSN=https://<server_key>@oXXXXXX.ingest.sentry.io/<projectId>
  ```

  or via the Supabase dashboard (Project Settings -> Edge Functions -> Secrets).

- Optionally set `SENTRY_ENVIRONMENT=production` (or whatever label the operator prefers in the Sentry-side dropdown).

The Edge DSN must NEVER be the SPA's `VITE_SENTRY_DSN`. The constitution's "What we refuse" forbids the SPA's public DSN from carrying server-side error context, and the Edge-side DSN by convention is a server-side key (different rate-limit envelope).

## Verification (deferred — operator-side smoke)

The same controlled-throw posture the SPA wrapper was verified with applies here: once the operator sets `SENTRY_DSN` against an Edge Function deploy, throwing a synthetic error from any handler (or running a CI probe that hits an intentionally-erroring route) lands an event in Sentry. Payload check:

- `tags.bundle` is the bundle name.
- `tags.route` is the route pattern, NOT the live URL.
- `user.id` is the opaque org UUID (when the request carried a valid JWT), or absent.
- `user.ip_address` is `null`.
- No Authorization header, no cookies, no query string.
- No email-pattern leak in message or exception value.

## Constitutional invariants verified

- Banned-deps list (`antd`, `@radix-ui/*`, `redux`, ...) untouched. No new top-level deps. The SPA's `@sentry/react` remains the only Sentry-family dep in the tree.
- Money rules untouched.
- RLS rules untouched.
- Migration rules untouched (no migration).
- Zod canon untouched.
- Idempotency contract untouched.
- Audit log contract untouched (no new audit writes, no schema change).
- Capability gates untouched.
- Forbidden-in-copy rules (em dashes, double hyphens, emojis) honored across the new files.
- Branding: "Kitstak", single capital K, throughout.
