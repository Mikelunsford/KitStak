// notifications-worker: pulls undelivered notifications and marks them
// delivered. Authenticated by the X-Worker-Secret header (config.toml entry
// sets verify_jwt = false; the secret is the bearer of trust here).
//
// POST /drain
//   Pulls up to MAX_BATCH undelivered notifications across all orgs (sorted
//   by queued_at asc), invokes the channel's transport (a no-op in v1, since
//   no email provider is wired), then stamps delivered_at.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { ApiError, ok, fromApiError, noContent } from '../_shared/responses.ts';

const MAX_BATCH = 200;

interface NotificationRow {
  id: string;
  org_id: string;
  recipient_user_id: string;
  channel: string;
  subject: string;
  body: string | null;
  payload: Record<string, unknown>;
}

async function deliverChannel(row: NotificationRow): Promise<boolean> {
  // v1: in-app notifications need no transport (the SPA reads the row).
  // Email and webhook transports are TODO; we mark them delivered to clear
  // the queue, but log a warning so the operator wires a real transport
  // before relying on these channels.
  if (row.channel === 'inapp') return true;
  if (row.channel === 'email') {
    console.warn(
      'notifications-worker: email transport not wired, marking delivered',
      { notification_id: row.id },
    );
    return true;
  }
  if (row.channel === 'webhook') {
    console.warn(
      'notifications-worker: webhook transport not wired, marking delivered',
      { notification_id: row.id },
    );
    return true;
  }
  return false;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return noContent();
  const url = new URL(req.url);
  if (!url.pathname.endsWith('/drain')) {
    return fromApiError(new ApiError('NOT_FOUND', 404));
  }
  if (req.method !== 'POST') {
    return fromApiError(new ApiError('METHOD_NOT_ALLOWED', 405));
  }

  const expectedSecret = Deno.env.get('WORKER_SECRET');
  const presentedSecret = req.headers.get('x-worker-secret');
  if (!expectedSecret || presentedSecret !== expectedSecret) {
    return fromApiError(new ApiError('UNAUTHORIZED', 401));
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return fromApiError(
      new ApiError('INTERNAL_ERROR', 500, 'Missing service-role credentials'),
    );
  }

  const client = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await client
    .from('notifications')
    .select('id, org_id, recipient_user_id, channel, subject, body, payload')
    .is('delivered_at', null)
    .order('queued_at', { ascending: true })
    .limit(MAX_BATCH);

  if (error) {
    return fromApiError(new ApiError('INTERNAL_ERROR', 500, error.message));
  }

  let delivered = 0;
  let failed = 0;
  for (const row of (data ?? []) as NotificationRow[]) {
    const okSend = await deliverChannel(row);
    if (!okSend) {
      failed += 1;
      continue;
    }
    const { error: updErr } = await client
      .from('notifications')
      .update({ delivered_at: new Date().toISOString() })
      .eq('id', row.id);
    if (updErr) {
      console.error('notifications-worker: stamp delivered_at failed', {
        notification_id: row.id,
        message: updErr.message,
      });
      failed += 1;
    } else {
      delivered += 1;
    }
  }

  return ok({
    polled: (data ?? []).length,
    delivered,
    failed,
  });
});
