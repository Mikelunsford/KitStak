# Path B1 verified live in prod — first real customer email delivered

**Date:** 2026-05-21
**Decision:** Path B1 closed. Path B2 (customer portal magic-link sign-in) cleared to dispatch.
**Driven by:** Operator-led smoke test on prod after autonomous secret provisioning.

## Context

PR #86 (Path B1, merged 2026-05-21 at 16:26:03Z) shipped the Resend HTTP transport + the producer side in quote/invoice send handlers + the 5-minute drain scheduler. The chassis was complete but unverified end-to-end. Operator authorized autonomous provisioning, then ran a real smoke against a test customer.

## What ran (chronologically)

### Autonomous secret provisioning

1. Audited Supabase Edge Function secrets via `supabase secrets list --project-ref zmnvwhqjahwidprnjxrq`. Confirmed `EMAIL_PROVIDER`, `RESEND_API_KEY`, `RESEND_FROM` already set by the operator; `WORKER_SECRET` missing.
2. Generated `WORKER_SECRET` via `openssl rand -hex 32`. Set it atomically on both Supabase Edge Function secrets AND GitHub repo Actions secrets via piped commands so the value never crossed process boundaries the harness could log; immediately `unset` the variable after.
3. Verified both sides: GitHub `WORKER_SECRET` listed at 16:25:37Z; Supabase digest `ec6537ead...` confirmed present.

### PR #86 merge + deploy

4. PR #86 CI green; squash-merged at 16:26:03Z.
5. `deploy-functions.yml` workflow auto-fired on the push to main; deploy completed in ~3 minutes.

### Manual drain verification (empty queue)

6. Triggered `notifications-drain.yml` via `gh workflow run`. Response: `{"data":{"polled":0,"delivered":0,"failed":0}}`. Confirmed the WORKER_SECRET match between GitHub Actions and Supabase + the worker bundle alive.

### Operator end-to-end smoke

7. Operator set `Acme Co.` customer's `primary_email = Mike@Team-01.com` (their own inbox, on the verified `kitstak.com` Resend sender domain — actually on team-01.com, which Resend accepts as the recipient address since recipient domain doesn't need verification; only the FROM domain does).
8. Operator clicked Send on quote `123123` (UUID `c1c0fc11-eb4d-4ac0-9766-b4ea8e0519ca`). Each click POSTed to `/quotes-api/quotes/:id/send` and returned 200. Operator clicked 7 times because no visible UI feedback indicated success — this is the spawn for F-Wave9-SEND-FEEDBACK-01.
9. SQL query against `notifications` table confirmed 7 rows queued with `channel='email'`, `entity_type='quote'`, `payload->>to = 'Mike@Team-01.com'`, all `delivered_at = null`.

### Manual drain to flush the queue

10. Triggered `notifications-drain.yml` again. Response: **`{"data":{"polled":7,"delivered":7,"failed":0}}`**.
11. SQL re-query: `still_pending: 0, delivered: 7`. Every row's `delivered_at` stamped.

### Inbox confirmation

12. Operator confirmed 7 emails arrived at `Mike@Team-01.com` at 11:36 AM local. Sender header rendered as `Kitstak <notifications@kitstak.com>` with proper friendly name display. Subject `Quote 123123`. Body `Hi Acme Co.,\n\nYour quote 123123 is ready for review. Reply to this email if you have any questions.\n\nThanks.` rendered cleanly. No escape weirdness on the FROM header (the v-vs-actual angle bracket test from PR #86 review checklist).

## Constitutional invariants verified live

| Invariant | How |
|---|---|
| Recipient resolution chain (body override > customer.primary_email > 422) | All 7 sends resolved via `Acme Co.`'s `primary_email`; no override sent; no 422 fired |
| `payload.to` required by Resend sender | All 7 rows carried the email in `payload->>to`; none required a fallback path |
| `delivered_at` reflects real delivery (F-Wave6-NOTIF-01 invariant) | 0 false positives — failed sends would have left `delivered_at` NULL; observed 7/7 actual deliveries with timestamps |
| Idempotency on `/send` | Each click had a fresh `Idempotency-Key`; the handler treats them as 7 independent intents (consistent with the FSM — `sent_at` overwrites on each call). Side-spawned a question: should idempotency on a Send dedupe within a short window? |
| RLS Pattern A on notifications | All 7 rows carried `org_id = ba4622dd-eb46-41b6-b2dd-95c922bf44dd`; no cross-tenant leakage |
| Money + audit + capability + migration rules | Untouched (Path B1 added zero migration, capability, money, or audit surface) |

## Closes

- **`Path B1`** — Resend HTTP transport, notifications producer in quote/invoice send handlers, drain scheduler workflow. Verified end-to-end against prod.

## Spawns

- **`F-Wave9-SEND-FEEDBACK-01`** (filed in this PR): Send button on quote/invoice detail pages needs success/error/pending feedback. Operator clicked 7 times during smoke without UI confirmation. Scope and rationale in STATUS.md.

## Open questions for Path B (future PRs)

These are observations from the live smoke, not blockers:

1. **Repeat-send dedup**: should the Send button hide after the first successful send (i.e. once `sent_at IS NOT NULL`)? Or should multi-send be a deliberate "resend" feature? Today it's an accidental dup-mailing vector. Probably worth a separate decision before Path B2 demos to a real customer.
2. **PDF attachment**: today's email is text-only. The PDF for the quote already renders via `pdf-worker`; threading the PDF bytes through `payload.attachment` and Resend's attachments API is a clean follow-up once the operator wants it. Trade-off: each attachment adds latency and Resend has a 40 MB limit; for very long quotes we'd need to fall back to a hosted link (which is exactly `F-Wave8-PDF-STORAGE-BUCKET-01`).
3. **Body templates**: today's body is hardcoded English. The chassis can grow to render templates per `org_settings.email_template_overrides` when an operator wants per-tenant branding. Defer until first customer asks.

## Next dispatch

Path B2: light up `/portal/*` SPA pages reading from existing `customer-portal-api`. Could ride on Resend for magic-link auth (email a one-time-use token to customer, exchange for portal session). Operator confirmation required before scope.
