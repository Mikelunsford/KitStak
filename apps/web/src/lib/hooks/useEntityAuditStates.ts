/**
 * useEntityAuditStates. Reads `audit_log` rows for one entity and returns
 * the de-duplicated set of `to_state` values the entity has actually
 * occupied, plus the initial `from_state` of the oldest row.
 *
 * Used by `<StateStepper>` consumers (e.g. InvoiceDetailPage) to render
 * past steps as truly visited rather than implied by the canonical happy
 * path. Closes F-Wave9-COWORK-SMOKE-07: the invoice FSM allows
 * `draft -> sent` directly (skipping `pending`), so when the stepper
 * coloured every step before the current index as past, the operator
 * saw PENDING filled even though audit_log only recorded
 * `draft -> sent`.
 *
 * Query shape mirrors AuditTimeline: same `audit_log` table, same RLS
 * gating, same key factory namespace so cache invalidation by entity
 * hits both consumers in one pass.
 */
import { useQuery } from '@tanstack/react-query';

import { auditLogKeys } from '@/lib/queryKeys/auditLog';
import { supabase } from '@/lib/supabase';

export interface EntityAuditStates {
  /**
   * Every distinct state the entity has occupied per audit_log, ordered
   * oldest-first. Includes the initial `from_state` of the first row
   * (so a `draft -> sent` audit row produces `['draft', 'sent']`) and
   * every subsequent `to_state`.
   */
  visited: readonly string[];
}

async function fetchEntityAuditStates(
  entityType: string,
  entityId: string,
): Promise<EntityAuditStates> {
  const { data, error } = await supabase
    .from('audit_log')
    .select('from_state, to_state, triggered_at')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('triggered_at', { ascending: true })
    .limit(200);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]!;
    // Seed the visited set with the very first row's from_state so the
    // entity's initial state (which never appears as a to_state) is
    // represented. After the first row, only to_state contributes.
    if (i === 0 && typeof row.from_state === 'string' && !seen.has(row.from_state)) {
      seen.add(row.from_state);
      ordered.push(row.from_state);
    }
    if (typeof row.to_state === 'string' && !seen.has(row.to_state)) {
      seen.add(row.to_state);
      ordered.push(row.to_state);
    }
  }
  return { visited: ordered };
}

export function useEntityAuditStates(
  entityType: string,
  entityId: string | null | undefined,
) {
  const enabled = typeof entityId === 'string' && entityId.length > 0;
  return useQuery({
    queryKey: auditLogKeys.visitedStates(entityType, (entityId as string) ?? ''),
    queryFn: () => fetchEntityAuditStates(entityType, entityId as string),
    enabled,
    staleTime: 30_000,
  });
}
