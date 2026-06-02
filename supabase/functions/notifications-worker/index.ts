// notifications-worker: pulls undelivered notifications and invokes the
// per-channel sender. Authenticated by the X-Worker-Secret header
// (config.toml entry sets verify_jwt = false; the secret is the bearer of
// trust here).
//
// POST /drain
//   Pulls up to MAX_BATCH undelivered notifications across all orgs (sorted
//   by queued_at asc), invokes the channel's sender (see
//   `_shared/notifications/senders.ts`), and stamps `delivered_at` only when
//   the sender returns ok:true. Failed sends leave the row pending so the
//   next drain re-attempts them; the response counter reports both delivered
//   and failed for the operator's dashboard.
//
// Closes F-Wave6-NOTIF-01 (drift-audit-consolidated 2026-05-18, Tier 1):
// the previous `deliverChannel` stub silently stamped `delivered_at` on
// email/webhook rows with only a `console.warn`, causing silent data loss.

import { ApiError, ok, fromApiError, internalError } from '../_shared/responses.ts';
import { admin } from '../_shared/handler-helpers.ts';
import { serverCorsHeaders } from '../_shared/cors.ts';
import { senderFor, type NotificationRow } from '../_shared/notifications/senders.ts';
import { ERROR_CODES, HTTP_HEADERS } from '../_shared/constants.ts';

const MAX_BATCH = 200;

Deno.serve(async (req: Request) => {
  // Server-only worker: emit the non-browser CORS origin (D6).
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: serverCorsHeaders() });
  }
  const url = new URL(req.url);
  if (!url.pathname.endsWith('/drain')) {
    return fromApiError(new ApiError(ERROR_CODES.NOT_FOUND, 404));
  }
  if (req.method !== 'POST') {
    return fromApiError(new ApiError(ERROR_CODES.METHOD_NOT_ALLOWED, 405));
  }

  const expectedSecret = Deno.env.get('WORKER_SECRET');
  const presentedSecret = req.headers.get(HTTP_HEADERS.X_WORKER_SECRET);
  if (!expectedSecret || presentedSecret !== expectedSecret) {
    return fromApiError(new ApiError(ERROR_CODES.UNAUTHORIZED, 401));
  }

  let client;
  try {
    client = admin();
  } catch (err) {
    if (err instanceof ApiError) return fromApiError(err);
    return fromApiError(internalError('notifications-worker:admin', err));
  }

  const { data, error } = await client
    .from('notifications')
    .select('id, org_id, recipient_user_id, channel, subject, body, payload')
    .is('delivered_at', null)
    .order('queued_at', { ascending: true })
    .limit(MAX_BATCH);

  if (error) {
    return fromApiError(internalError('notifications-worker', error));
  }

  let delivered = 0;
  let failed = 0;
  for (const row of (data ?? []) as NotificationRow[]) {
    const sender = senderFor(row.channel);
    const result = await sender(row);

    if (!result.ok) {
      // Failure path: leave `delivered_at` NULL so the next drain re-attempts
      // the row (when `retryable: true`) or operator inspection picks it up
      // (when `retryable: false`). One structured log line per attempt; the
      // string MUST NOT contain "transport not wired" (regression guard).
      failed += 1;
      console.warn('notifications-worker: send failed', {
        notification_id: row.id,
        channel: row.channel,
        reason: result.reason,
        retryable: result.retryable,
        message: result.message ?? null,
      });
      continue;
    }

    const { error: updErr } = await client
      .from('notifications')
      .update({ delivered_at: new Date().toISOString() })
      .eq('id', row.id);

    if (updErr) {
      console.error('notifications-worker: stamp delivered_at failed', {
        notification_id: row.id,
        channel: row.channel,
        message: updErr.message,
      });
      failed += 1;
      continue;
    }

    delivered += 1;
    console.info('notifications-worker: send succeeded', {
      notification_id: row.id,
      channel: row.channel,
    });
  }

  return ok({
    polled: (data ?? []).length,
    delivered,
    failed,
  });
});
