// Notification sender abstraction for notifications-worker.
//
// Closes F-Wave6-NOTIF-01 (drift-audit-consolidated 2026-05-18, Tier 1).
//
// Each channel registers a sender that performs the actual delivery. When a
// channel has no transport configured (env vars absent), the sender returns a
// SendFailure result rather than throwing — the worker uses that to leave
// `delivered_at` NULL and increment the failed counter. The constitutional
// invariant: `delivered_at` reflects real delivery, never a silent stub drain.
//
// Plug-in shape: to add a new channel, add an entry to SENDERS keyed by the
// channel string. Each sender must:
//   * Read its own transport env vars at call-time via Deno.env.get (NOT at
//     module load — workers may be cold-started before secrets are set).
//   * Return a SendResult; throw only on unexpected programmer error.
//   * Be pure with respect to the notifications row state (the worker is
//     responsible for stamping delivered_at, not the sender).

export type SendSuccess = { ok: true };
export type SendFailure = {
  ok: false;
  reason: SendFailureReason;
  retryable: boolean;
  message?: string;
};

export type SendFailureReason =
  | 'transport_not_configured'
  | 'transport_rejected'
  | 'unknown_channel'
  | 'send_error';

export type SendResult = SendSuccess | SendFailure;

export interface NotificationRow {
  id: string;
  org_id: string;
  recipient_user_id: string;
  channel: string;
  subject: string;
  body: string | null;
  payload: Record<string, unknown>;
}

export type Sender = (row: NotificationRow) => Promise<SendResult>;

function denoEnv(key: string): string | undefined {
  // Indirection so a test could later monkey-patch this. Today it reads
  // Deno.env.get directly. The notifications-worker shim's FAKE_ENV does
  // NOT set EMAIL_PROVIDER / SMTP_* / WEBHOOK_URL, so every email/webhook
  // attempt under regression-test conditions returns transport_not_configured.
  return Deno.env.get(key);
}

// In-app: the SPA reads the row directly, so delivery is the act of leaving
// the row visible. Always succeeds.
const inappSender: Sender = async () => {
  return { ok: true };
};

// Email: requires an external provider. We read EMAIL_PROVIDER plus the
// provider-specific keys at call-time. When unset, we fail closed.
//
// Supported providers (operator selects via EMAIL_PROVIDER):
//   - "smtp"   : SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
//                (chassis present; SMTP HTTP call not implemented; pick Resend
//                unless an explicit SMTP host operator chooses otherwise)
//   - "resend" : RESEND_API_KEY, RESEND_FROM. Posts to api.resend.com/emails
//                via the Deno runtime's built-in fetch. Closes the Path B1
//                end-to-end quote/invoice email slice.
//
// Recipient resolution: the email address comes from `row.payload.to` (string).
// The notifications producer (quote/invoice send handlers in this PR) reads
// `customers.primary_email` and threads it through. The sender fails closed
// with transport_not_configured if `payload.to` is absent so we never silently
// drop a queued email; the operator can fix the upstream caller and the
// next worker drain retries.
const emailSender: Sender = async (row) => {
  const provider = denoEnv('EMAIL_PROVIDER');
  if (!provider) {
    return {
      ok: false,
      reason: 'transport_not_configured',
      retryable: false,
      message: 'EMAIL_PROVIDER env var not set',
    };
  }
  if (provider === 'smtp') {
    const host = denoEnv('SMTP_HOST');
    const from = denoEnv('SMTP_FROM');
    if (!host || !from) {
      return {
        ok: false,
        reason: 'transport_not_configured',
        retryable: false,
        message: 'SMTP_HOST / SMTP_FROM env vars not set',
      };
    }
    return {
      ok: false,
      reason: 'transport_rejected',
      retryable: true,
      message: `SMTP send for notification ${row.id} not implemented in this build`,
    };
  }
  if (provider === 'resend') {
    return sendViaResend(row);
  }
  return {
    ok: false,
    reason: 'transport_not_configured',
    retryable: false,
    message: `Unknown EMAIL_PROVIDER value: ${provider}`,
  };
};

// Resend HTTP transport.
//
// POST https://api.resend.com/emails
// Headers:
//   Authorization: Bearer <RESEND_API_KEY>
//   Content-Type: application/json
// Body: { from, to, subject, text }
//
// Success: 200 / 201 / 202 with JSON body { id, ... } -> SendSuccess.
// 4xx: transport_rejected, retryable:false (config error or bad recipient).
//      Worker leaves delivered_at NULL; the row sits for operator inspection.
// 5xx: transport_rejected, retryable:true (Resend transient).
// Network error: send_error, retryable:true.
async function sendViaResend(row: NotificationRow): Promise<SendResult> {
  const apiKey = denoEnv('RESEND_API_KEY');
  const from = denoEnv('RESEND_FROM');
  if (!apiKey || !from) {
    return {
      ok: false,
      reason: 'transport_not_configured',
      retryable: false,
      message: 'RESEND_API_KEY / RESEND_FROM env vars not set',
    };
  }
  const to =
    typeof row.payload?.to === 'string' ? (row.payload.to as string) : null;
  if (!to) {
    return {
      ok: false,
      reason: 'transport_not_configured',
      retryable: false,
      message:
        'payload.to (recipient email) absent on notification row; producer must populate it',
    };
  }
  const body = {
    from,
    to,
    subject: row.subject,
    text: row.body ?? '',
  };
  let res: Response;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return {
      ok: false,
      reason: 'send_error',
      retryable: true,
      message: err instanceof Error ? err.message : String(err),
    };
  }
  if (res.status >= 200 && res.status < 300) {
    return { ok: true };
  }
  // Drain the response body so we can include the Resend error message in the
  // worker log without leaving the connection hanging. Resend returns JSON like
  // { name: 'validation_error', message: '...' }; we just stringify.
  let detail = '';
  try {
    detail = await res.text();
  } catch {
    // Body already consumed or unreadable; fall back to status code only.
  }
  return {
    ok: false,
    reason: 'transport_rejected',
    retryable: res.status >= 500,
    message: `Resend POST returned HTTP ${res.status}${detail ? `: ${detail.slice(0, 500)}` : ''}`,
  };
}

// Webhook: HTTP POST to either a per-row payload.webhook_url or a globally
// configured WEBHOOK_URL. We do attempt the POST when configured; failure
// surfaces as transport_rejected.
const webhookSender: Sender = async (row) => {
  const perRowUrl =
    typeof row.payload?.webhook_url === 'string'
      ? (row.payload.webhook_url as string)
      : null;
  const globalUrl = denoEnv('WEBHOOK_URL');
  const url = perRowUrl ?? globalUrl;
  if (!url) {
    return {
      ok: false,
      reason: 'transport_not_configured',
      retryable: false,
      message:
        'No WEBHOOK_URL env var and no payload.webhook_url on the notification row',
    };
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: row.id,
        org_id: row.org_id,
        subject: row.subject,
        body: row.body,
        payload: row.payload,
      }),
    });
    if (!res.ok) {
      return {
        ok: false,
        reason: 'transport_rejected',
        retryable: res.status >= 500,
        message: `Webhook POST returned HTTP ${res.status}`,
      };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: 'send_error',
      retryable: true,
      message: err instanceof Error ? err.message : String(err),
    };
  }
};

const SENDERS: Record<string, Sender> = {
  inapp: inappSender,
  email: emailSender,
  webhook: webhookSender,
};

/**
 * Look up the sender for a channel. Unknown channels resolve to a sender that
 * fails closed with reason='unknown_channel'.
 */
export function senderFor(channel: string): Sender {
  const s = SENDERS[channel];
  if (s) return s;
  return async () => ({
    ok: false,
    reason: 'unknown_channel',
    retryable: false,
    message: `No sender registered for channel="${channel}"`,
  });
}

/**
 * Test seam: replace a sender at runtime. Returns the previous sender so the
 * caller can restore it. Used by integration tests that want to assert the
 * worker's failure path without depending on real transport env vars.
 */
export function registerSender(channel: string, sender: Sender): Sender | null {
  const prev = SENDERS[channel] ?? null;
  SENDERS[channel] = sender;
  return prev;
}
