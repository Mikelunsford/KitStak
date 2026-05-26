# Send button feedback (F-Wave9-SEND-FEEDBACK-01)

Date: 2026-05-26
Branch: feat/send-feedback-quote-invoice
PR: feat(quotes,invoicing): Send button pending/success/error feedback

## Why

During the 2026-05-21 prod smoke walk the operator clicked Send seven
times in a row on the same invoice because the button fired the
mutation but rendered no visible feedback. The Send action is the
moment the customer-facing artifact actually leaves the system; the UI
must not leave the operator guessing.

## What changed

1. New pure helper `apps/web/src/lib/workflow/sendButtonFeedback.ts`.
   Takes the TanStack Query mutation flags plus the entity's `sent_at`
   and returns the label, the disabled flag, helper microcopy, and an
   optional error or success line. Shared by both detail pages so the
   two surfaces drift together if at all.
2. `apps/web/src/pages/3pl-operations/quotes/QuoteDetailPage.tsx`.
   Replaces the bare `Send to customer` button with a feedback-aware
   block driven by `computeSendButtonFeedback`. Idle copy stays as
   "Send to customer"; pending, success, resend, and error states fall
   back to the helper-resolved copy.
3. `apps/web/src/pages/3pl-operations/invoicing/InvoiceDetailPage.tsx`.
   Same treatment on the Send button. Drops `sendMutation.error` from
   the combined header error line since it is now rendered inline.

## States rendered

| State | Label | Disabled | Helper / success | Error |
|---|---|---|---|---|
| Idle, first send | "Send to customer" / "Send" | no | none | none |
| Pending | "Sending..." | yes | none | none |
| Success | "Sent." | yes | "Email queued for delivery." | none |
| Error | "Send" or "Send again" | no | none | actual `mutation.error.message` |
| Idle, already sent | "Send again" | no | "This was already sent on {date}." | none |

Trailing dots are three ASCII periods (`...`), not an em dash, per the
constitution.

## Constitutional alignment

- No em dash, no double hyphen, no emoji in any copy.
- Tailwind tokens only (`bg-accent`, `text-ink`, `text-ink-dim`,
  `text-accent`, `font-sans`).
- No new top-level dependency.
- Existing date formatter (`formatDateMedium` from `@/lib/dates`).
- Pure-function helper with vitest tests under
  `apps/web/test/regression/send-button-feedback.test.ts`, in line with
  the repo's no-jsdom convention.

## Tests

- 14 unit tests covering idle, pending, success, error, resend,
  pending-priority-over-error-and-success, em-dash absence, and
  fallback error copy.
- `pnpm typecheck` green.
- `pnpm test` green (190 passed, 2 pre-existing skipped).
- `pnpm build` green.

## Follow-ups

None spawned. The 2026-05-21 smoke item that motivated this work is
fully closed.
