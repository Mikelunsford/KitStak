# Backend — notifications-worker real delivery (Cycle 2b)

Author: Backend Engineer (Cycle 2b of pre-Customer-Zero Tier 1 fix work)
Branch: `claude/notifications-delivery` (local; not pushed)
Closes: `F-Wave6-NOTIF-01` from `2026-05-18-drift-audit-consolidated.md`
Companion: `2026-05-18-qa-tier1-regression.md` (Cycle 1 authored the failing regression tests this cycle makes pass).

## What shipped

Two file changes:

* `supabase/functions/_shared/notifications/senders.ts` — new module. Per-channel sender registry plus a `senderFor(channel)` lookup. Each sender returns a `SendResult = SendSuccess | SendFailure` discriminated union.
* `supabase/functions/notifications-worker/index.ts` — rewritten drain loop. Removed the `deliverChannel` helper. The worker now calls `senderFor(row.channel)(row)` and treats `{ ok: false }` as a failed delivery: the `delivered_at` UPDATE is skipped, the `failed` counter increments, and a structured `console.warn('notifications-worker: send failed', { … })` line is emitted (the literal string `transport not wired` is gone, satisfying the regression spy).

No new database migrations. No new dependencies.

## Sender abstraction shape

`Sender = (row: NotificationRow) => Promise<SendResult>`.

Channels in the registry today:

| Channel | Behaviour |
|---|---|
| `inapp` | Always `{ ok: true }`. The SPA reads the notifications row directly, so delivery is the act of leaving the row visible. |
| `email` | Reads `EMAIL_PROVIDER` at call-time. If absent → `transport_not_configured`. If `smtp`, additionally requires `SMTP_HOST` + `SMTP_FROM`. If `resend`, additionally requires `RESEND_API_KEY` + `RESEND_FROM`. With provider config present, returns `transport_rejected` with `retryable: true` — wiring the actual HTTP/SMTP call is a follow-up once the operator picks a provider (no banned dep was added; the constitution-review checklist did not trigger). |
| `webhook` | Reads per-row `payload.webhook_url` first, falls back to `WEBHOOK_URL` env. If neither is set → `transport_not_configured`. If a URL is present, performs `fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, org_id, subject, body, payload }) })` and reports `transport_rejected` on non-2xx, `send_error` on network failure. |
| unknown | `senderFor()` returns a closure that yields `{ ok: false, reason: 'unknown_channel', retryable: false }`. The worker treats this the same as any other failure: leaves the row pending and increments `failed`. |

Plug-in shape for new channels: add an entry to the `SENDERS` map in `_shared/notifications/senders.ts`. Senders must read transport env vars at call-time (not at module load — Edge Function cold starts may pre-date secret bind). The exported `registerSender(channel, sender)` seam exists for integration tests that want to swap a sender at runtime; the regression tests rely on the env-var-absent failure path, so they do not use it today.

## Failure path

When a sender returns `{ ok: false }`:

1. `delivered_at` stays NULL (no UPDATE issued for that row).
2. The `failed` counter in the response envelope increments by 1.
3. One `console.warn` line is emitted with `{ notification_id, channel, reason, retryable, message }`. The string `transport not wired` is NOT present (regression test spy asserts on this literal).
4. On the next drain, the row is re-selected (still `delivered_at IS NULL`) and retried. The `SendFailure.retryable` field is currently informational; a future change could route non-retryable failures (`unknown_channel`, missing config) to a dead-letter table — flagged as carry-forward below.

## Env vars read

The worker itself reads only what it already did:

* `WORKER_SECRET` (bearer)
* `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (admin client)

The senders module reads (lazily, at call-time):

* `EMAIL_PROVIDER` — one of `smtp` or `resend`. Operator must set this to enable email.
* `SMTP_HOST`, `SMTP_PORT` (informational), `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` — if `EMAIL_PROVIDER=smtp`.
* `RESEND_API_KEY`, `RESEND_FROM` — if `EMAIL_PROVIDER=resend`.
* `WEBHOOK_URL` — global fallback when a notification row's `payload.webhook_url` is unset.

The regression `FAKE_ENV` in `apps/web/test/regression/_helpers/deno-shim.ts` deliberately does NOT set any of these, so every email/webhook attempt under test conditions returns `transport_not_configured` and the worker reports `failed` rather than silent delivery. That is the test surface the QA cycle asked for.

## Idempotency

Per dispatch guidance, I considered inserting a row into `idempotency_keys` per `(notification_id, channel)` to gate double-invocation under the same drain key. I deferred this because:

* The constitutional Idempotency-Key discipline is for non-GET caller-facing handlers. The worker is invoked by cron, not a user; it has no caller.userId to populate the PK column with.
* True row-level locking belongs in a `claimed_at` column on `notifications`, which is a schema change — explicitly out of scope per the dispatch ("Do NOT add a database migration; flag it in handoff").
* The existing `delivered_at IS NULL` SELECT filter already provides drain-level idempotency: a successfully delivered row will not be re-picked. The remaining hazard is two concurrent worker invocations racing on the same NULL row; that requires DB-side advisory locks or a `claimed_at` column to close.

See carry-forward below for the schema-change request to Migrations Engineer.

## Test results

`pnpm --filter web test`:

* `src/lib/money.test.ts` — 5 PASS.
* `test/regression/notifications-delivery.test.ts` — **2 PASS** (this cycle's deliverable).
* `test/regression/pagination-cursor.test.ts` — 2 failing, 2 skipped (Cycle 2a's territory, expected).
* `test/regression/inventory-pagination.test.ts` — 3 failing (Cycle 2a's territory, expected).

`pnpm --filter web typecheck` — PASS.
`pnpm --filter web lint` — PASS.

## Carry-forwards

1. **Schema for true row-level idempotency on the worker**: propose a forward migration adding `notifications.claimed_at TIMESTAMPTZ` plus a worker-side `UPDATE … SET claimed_at = now() WHERE id = ? AND claimed_at IS NULL RETURNING id` claim pattern. Owner: Migrations Engineer. Defer until two-cron-instance concurrency is on the table; today there is a single cron caller per env.
2. **Real email transport wiring**: the senders module currently returns `transport_rejected` for fully-configured email providers because the actual SMTP/Resend HTTP call is not implemented. Owner: Backend Engineer once operator picks `smtp` vs `resend`. The constitution does not yet list an HTTP-email dep; adding one will trigger the constitution-review checklist.
3. **Dead-letter routing for non-retryable failures**: today every failed row is left pending and re-attempted on the next drain. `unknown_channel` and `transport_not_configured` will never succeed without operator intervention; they should land in a `notifications_dead_letter` table or stamp a `failed_at` + `failure_reason` on the original row. Schema change → flag for Migrations Engineer. Owner: Backend Engineer once the schema exists.
4. **F-Wave6-SEC-02 (bearer-secret timing-safe compare)**: the worker still uses `presentedSecret !== expectedSecret`. This was scoped to Tier 4 hardening; I did not touch the bearer check in this cycle because the fix surface didn't require it. Owner: Security Reviewer's Tier 4 dispatch.

## Refusals or constitutional flags

None. The dispatch did not ask me to weaken any invariant. No banned dependencies were added. No migration was required. No em-dashes, double-hyphens, or emojis were introduced in user-facing copy (the `console.warn` strings are internal observability, not user copy).

The one mild departure from convention: the new senders module lives at `supabase/functions/_shared/notifications/senders.ts` rather than the flat `_shared/` root. There is precedent for nested `_shared` subdirectories (`_shared/types/*.ts`, `_shared/capabilities/*.ts`, `_shared/workflow/*.ts`), so this is in-canon.
