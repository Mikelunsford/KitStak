// Audit service. Reads audit_log via the supabase client (RLS-enforced).
// The AuditTimeline component reads the table directly; this helper wraps
// the same query for non-React consumers (workers, batch readers).

import { supabase } from '@/lib/supabase';
import { AuditLogSchema, type AuditLog } from '@/lib/types/cross_cutting';

export async function listAuditEntries(
  entityType: string,
  entityId: string,
  limit = 50,
): Promise<AuditLog[]> {
  const { data, error } = await supabase
    .from('audit_log')
    .select(
      'id, org_id, entity_type, entity_id, from_state, to_state, action, triggered_by, triggered_at, diff_json, prev_hash, payload_hash',
    )
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('triggered_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => AuditLogSchema.parse(row));
}
