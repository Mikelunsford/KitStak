import { useQuery } from '@tanstack/react-query';

import { auditLogKeys } from '@/lib/queryKeys/auditLog';
import { supabase } from '@/lib/supabase';
import { AuditEntrySchema, type AuditEntry } from '@/lib/types';
import { RelativeTime } from '@/components/ui/RelativeTime';

import { formatStateLabel } from './auditStateFormatters';

/**
 * AuditTimeline. per-entity audit_log timeline.
 *
 * Reads `audit_log` via the supabase client (RLS-enforced: org_owner /
 * org_admin / accounting see rows; everyone else sees nothing). Renders
 * reverse-chronological actions with from/to state and diff.
 *
 * Wave 1 ships the placeholder render: when no entityId is bound or no
 * rows return, we render a neutral "No history yet." message. Wave 2
 * onward will bind this to real entities as workflows ship.
 */

interface AuditTimelineProps {
  entityType: string;
  entityId: string | null;
  limit?: number;
}

async function fetchAuditTimeline(
  entityType: string,
  entityId: string,
  limit: number,
): Promise<AuditEntry[]> {
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
  return (data ?? []).map((row) => AuditEntrySchema.parse(row));
}

export function AuditTimeline({
  entityType,
  entityId,
  limit = 50,
}: AuditTimelineProps) {
  const enabled = entityId !== null;
  const query = useQuery({
    queryKey: auditLogKeys.byEntity(entityType, entityId as string),
    queryFn: () => fetchAuditTimeline(entityType, entityId as string, limit),
    enabled,
    staleTime: 30_000,
  });

  if (!enabled) {
    return (
      <div className="text-sm text-ink-dim">No entity bound to timeline.</div>
    );
  }
  if (query.isLoading) {
    return <div className="text-sm text-ink-dim">Loading history.</div>;
  }
  if (query.isError) {
    return <div className="text-sm text-ink-dim">Unable to load history.</div>;
  }
  const rows = query.data ?? [];
  if (rows.length === 0) {
    return <div className="text-sm text-ink-dim">No history yet.</div>;
  }

  return (
    <ol className="space-y-2" data-testid="audit-timeline">
      {rows.map((row) => (
        <li key={row.id} className="border border-line p-2 text-sm">
          <div className="flex items-baseline justify-between">
            <span className="font-medium text-ink">
              {row.action ?? 'change'}
              {row.from_state && row.to_state ? (
                <span className="ml-2 text-ink-dim">
                  {formatStateLabel(entityType, row.from_state)} to{' '}
                  {formatStateLabel(entityType, row.to_state)}
                </span>
              ) : null}
            </span>
            <RelativeTime
              as="time"
              value={row.triggered_at}
              className="text-xs text-ink-dim"
            />
          </div>
          {row.diff_json !== null && row.diff_json !== undefined ? (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-ink-dim">
                Diff
              </summary>
              <pre className="mt-1 overflow-x-auto bg-bg-2 p-1 text-xs text-ink">
                {JSON.stringify(row.diff_json, null, 2)}
              </pre>
            </details>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
