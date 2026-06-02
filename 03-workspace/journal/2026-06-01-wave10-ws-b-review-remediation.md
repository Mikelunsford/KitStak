# WS-B review remediation. Idempotency hardening.

Wave: 10
Phase: Review remediation
Closes: F-Wave10-REVIEW-REMEDIATION (WS-B blocking review item)
Date: 2026-06-01

## Blocking review item

The WS-B implement step output was not registered as a committed artifact by the
orchestrator ("implement step did not commit"). This entry records the
verification that the implement step did land on disk and that every relevant
gate is green, and registers a committed remediation artifact for WS-B.

## Verification

The WS-B idempotency-hardening implementation is present in commit
fb44fe1a296b1ddddfbcbea17a47f3baffc460a0 on branch wave10-review-remediation.

Scope confirmed in that commit:

- B1. settings-api deleteSetting is wrapped in respondWithIdempotency, mirroring
  upsertSetting and collaboration-api deleteAttachment. The last unwrapped
  state-changing settings handler now enforces the Idempotency-Key invariant.
- B2. The shared idempotency wrapper reserves a pending row via
  INSERT ... ON CONFLICT DO NOTHING on the primary key, runs the handler only
  when the reservation is won, then stamps completion. A failed completion
  persist fails closed with INTERNAL_ERROR instead of returning an unrecorded
  200. Concurrent same-key callers see an in-flight 409 or a completed replay,
  never a second execution. Same key with a different body still returns
  409 IDEMPOTENCY_CONFLICT.
- B2. Forward migration 0086_idempotency_reserve_state.sql makes status_code
  nullable and adds a state column (pending or completed). Idempotent DDL with
  the canonical header block.
- B3. The canonicalize narrowing versus full RFC 8785 is documented. Inputs are
  Zod-normalized and the same serializer runs on store and on compare.

Regression coverage confirmed:

- test/regression/edge-pdf-worker-idempotency.test.ts. Exactly-once under
  concurrent same-key, persist-failure returns 5xx, in-flight 409, same-key
  different-body 409, and replay of the stored response.
- The shared supabase mock was extended with upsert support and the 0085
  max-migration guard was relaxed to forward-only.

## Gates run

- pnpm typecheck. Pass.
- pnpm test:contract. Pass. 3 files, 26 tests, including money.parity.
- pnpm test:regression. Pass. 56 files, 433 tests, 2 skipped. Includes the WS-B
  edge-pdf-worker-idempotency suite (7 tests) and the 0085 audit-chain ordering
  suite (27 tests) the wrapper rework touched.

## Constitutional alignment

- Idempotency. Every non-GET handler enforces Idempotency-Key. Reserve-before-
  execute guarantees exactly-once. Same key with different body returns
  409 IDEMPOTENCY_CONFLICT. Persist failure fails closed, never a silent
  unrecorded 200.
- Migration. 0086 is forward-only, four-digit zero-padded, idempotent DDL,
  canonical header. No prior numbered file edited.
- Mirror canons unchanged. idempotency.ts is worker-side only with no SPA
  mirror. money.parity and types parity still green.
- No new top-level dependency. crypto.randomUUID() only.

## Outcome

WS-B is verified committed and green. No further code change required for the
blocking item. This entry is the registered remediation artifact.
