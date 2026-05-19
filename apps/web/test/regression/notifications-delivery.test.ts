// Regression suite for F-Wave6-NOTIF-01 — notifications-worker silent delivery.
//
// Audit finding (03-workspace/journal/2026-05-18-drift-tech-debt.md item 4 and
// 03-workspace/journal/2026-05-18-drift-audit-consolidated.md Tier 1):
//   `deliverChannel` in `notifications-worker/index.ts:25-46` returns `true`
//   for channel='email' and channel='webhook' after only `console.warn`-ing.
//   The worker then stamps `delivered_at`, clearing the queue silently.
//   The moment a customer enables one of these channels, this is data loss.
//
// Target: supabase/functions/notifications-worker/index.ts:25-46
//
// Constitutional invariant protected:
//   CLAUDE.md "Audit log" / non-negotiables: the queue must reflect real
//   delivery state. `delivered_at` is the externally-visible proof of
//   delivery; stamping it without doing the work breaks every downstream
//   observability and replay invariant (operator dashboards, retry queues,
//   audit-chain reconciliation).
//
// Test shape (observable side effects only, no implementation prescribed):
//   (a) When an email-channel notification is processed AND no real
//       transport is wired (no SMTP_* / EMAIL_PROVIDER env vars), the
//       worker MUST NOT stamp `delivered_at` and MUST NOT emit the
//       legacy "transport not wired" stub warning that today's code
//       prints. Either the row is marked failed (data.failed === 1) or
//       the row is left pending for retry — but it is NEVER silently
//       drained.
//   (b) When the worker reports `delivered === 1` for the email row,
//       it MUST have done so without falling through the stub path —
//       which today is the only way the email channel ever reports
//       delivered. This test detects the exact stub-path code via the
//       `console.warn` spy and fails if it is taken.
//
// Backend Engineer Cycle 2 acceptance criteria:
//   * Remove `deliverChannel`'s stub `return true` branches for email/webhook.
//   * Wire a real sender abstraction (e.g. `_shared/notifications/senders.ts`
//     exporting `sendEmail`/`sendWebhook`).
//   * Treat absence of transport config (test env) as a failed send so
//     `delivered_at` stays NULL and `failed` increments.
//   * Propagate sender exceptions to the caller; do not swallow.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  installDenoShim,
  capturedHandler,
  resetCapturedHandler,
} from './_helpers/deno-shim.ts';
import {
  makeState,
  type MockState,
} from './_helpers/supabase-mock.ts';
import {
  setActiveMockState,
  clearActiveMockState,
} from './_helpers/supabase-stub.ts';

const WORKER_SECRET = 'test-worker-secret';

function makeEmailRow(id: string): Record<string, unknown> {
  return {
    id,
    org_id: '00000000-0000-4000-8000-0000000000a1',
    recipient_user_id: '00000000-0000-4000-8000-0000000000b1',
    channel: 'email',
    subject: 'Hello',
    body: 'World',
    payload: { from: 'noreply@example.test', to: 'op@example.test' },
    delivered_at: null,
    queued_at: new Date(Date.now() - 60_000).toISOString(),
  };
}

async function readJson(res: Response): Promise<unknown> {
  return JSON.parse(await res.text());
}

describe('notifications-worker email channel — silent delivery regression (F-Wave6-NOTIF-01)', () => {
  let handler: (req: Request) => Promise<Response> | Response;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    installDenoShim();
    resetCapturedHandler();
    await import('../../../../supabase/functions/notifications-worker/index.ts');
    handler = capturedHandler();
  });

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    clearActiveMockState();
  });

  it('does NOT take the stub "transport not wired" path for email', async () => {
    const rowId = '00000000-0000-4000-8000-00000000c001';
    const row = makeEmailRow(rowId);
    const state: MockState = makeState({ notifications: [row] });
    setActiveMockState(state);

    const req = new Request('https://example.test/drain', {
      method: 'POST',
      headers: { 'x-worker-secret': WORKER_SECRET },
    });
    const res = await handler(req);
    expect(res.status).toBe(200);

    // Bug surface: today's deliverChannel logs "email transport not wired"
    // via console.warn before returning true. Any future correct
    // implementation either (a) wires a real sender (no warn), or (b)
    // refuses to send and reports failed — but it never emits that exact
    // stub-marker warning, which is the visible fingerprint of the bug.
    const calls = warnSpy.mock.calls.map((args) =>
      args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '),
    );
    const stubMessages = calls.filter((m) =>
      /transport not wired/i.test(m),
    );
    expect(stubMessages).toEqual([]);
  });

  it('does NOT stamp delivered_at on an email row when no real transport is wired', async () => {
    const rowId = '00000000-0000-4000-8000-00000000c002';
    const row = makeEmailRow(rowId);
    const state: MockState = makeState({ notifications: [row] });
    setActiveMockState(state);

    const req = new Request('https://example.test/drain', {
      method: 'POST',
      headers: { 'x-worker-secret': WORKER_SECRET },
    });
    const res = await handler(req);
    expect(res.status).toBe(200);
    const body = (await readJson(res)) as {
      data: { polled: number; delivered: number; failed: number };
    };
    expect(body.data.polled).toBe(1);

    // The visible bug today: data.delivered === 1, data.failed === 0,
    // because deliverChannel's email branch unconditionally returns true.
    // After the fix, with no SMTP/EMAIL_PROVIDER env vars set in the test
    // shim, the send must fail closed: either failed === 1 with delivered
    // === 0, or polled === 1 with both counters === 0 (left pending).
    expect(body.data.delivered).toBe(0);

    // delivered_at must NOT be stamped on the notifications row.
    const deliveryUpdates = state.updates.filter(
      (u) =>
        u.table === 'notifications' &&
        'delivered_at' in u.patch &&
        u.patch.delivered_at !== null,
    );
    expect(deliveryUpdates).toEqual([]);
  });
});
