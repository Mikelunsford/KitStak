// Audit log writer.
//
// PRIMARY PATH: state-change audit rows are written by DB triggers attached
// to every entity that has a state machine. This helper exists ONLY for the
// non-state-change cases an edge handler may need to log: a create, an edit
// of an important field that has no state column, a soft-delete, or a
// domain action that does not move a state machine (e.g. `/send` events).
//
// Best-effort write: an audit insert that fails MUST NOT roll back the
// caller's primary action. We log to stderr and rethrow as
// ApiError('AUDIT_WRITE_FAILED') so the handler can choose to swallow.
// Most handlers will not swallow. They let the error surface so the
// nightly chain verifier flags a gap.
//
// Hash chain: prev_hash and payload_hash columns are populated by a DB
// trigger on insert, not by this helper. The application stays out of the
// hashing path so a handler bug cannot poison the chain.

import { admin } from './handler-helpers.ts';
import { ApiError } from './responses.ts';

export interface AuditEntry {
  orgId: string;
  entityType: string;
  entityId: string;
  fromState?: string | null;
  toState?: string | null;
  action: string;
  triggeredBy: string | null;
  diffJson?: Record<string, unknown> | null;
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface RequestContext {
  request_id: string;
  route_hash: string;
}

/**
 * Compute a shallow object diff. Returns `{ changed: { key: { before, after } } }`
 * for every key whose JSON-stringified value differs. If both inputs are
 * absent, returns null.
 */
export function computeDiff(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!before && !after) return null;
  if (!before) return { after };
  if (!after) return { before };
  const changed: Record<string, { before: unknown; after: unknown }> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    const a = (before as Record<string, unknown>)[k];
    const b = (after as Record<string, unknown>)[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      changed[k] = { before: a, after: b };
    }
  }
  return { changed };
}

/**
 * Package the current request id and route hash into the metadata shape the
 * audit_log expects. Use from a handler when calling `writeAudit` directly.
 */
export async function withRequestContext(
  req: Request,
  route: string,
): Promise<RequestContext> {
  const requestId =
    req.headers.get('x-request-id') ?? crypto.randomUUID();
  const data = new TextEncoder().encode(`${req.method} ${route}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const route_hash = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return { request_id: requestId, route_hash };
}

/**
 * Write a single row to public.audit_log via the service-role client. Throws
 * ApiError('AUDIT_WRITE_FAILED', 500) on insert failure; callers may choose
 * to catch and swallow, but the default posture is "let it surface". The
 * hash chain stays consistent because the DB trigger computes prev_hash and
 * payload_hash atomically with the insert.
 */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  const row = {
    org_id: entry.orgId,
    entity_type: entry.entityType,
    entity_id: entry.entityId,
    from_state: entry.fromState ?? null,
    to_state: entry.toState ?? null,
    action: entry.action,
    triggered_by: entry.triggeredBy,
    triggered_at: new Date().toISOString(),
    diff_json: entry.diffJson ?? null,
    notes: entry.notes ?? null,
    metadata: entry.metadata ?? {},
  };

  const { error } = await admin().from('audit_log').insert(row);
  if (error) {
    const message =
      typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message: string }).message)
        : String(error);
    console.error('audit_log insert failed', {
      detail: message,
      org_id: entry.orgId,
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      action: entry.action,
    });
    throw new ApiError('AUDIT_WRITE_FAILED', 500, message);
  }
}
