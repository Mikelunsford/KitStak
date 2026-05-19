/**
 * Query key factory for `audit_log` reads. Shared between the AuditTimeline
 * component (queryFn owner) and the mutations across the app that drive
 * state transitions and therefore need to invalidate the timeline cache
 * after a successful write.
 *
 * Pattern matches the other key factories under this folder: a stable
 * tuple shape so React Query's structural sharing and predicate-based
 * invalidation both work without churn.
 */
export const auditLogKeys = {
  all: ['audit_log'] as const,
  byEntity: (entityType: string, entityId: string) =>
    ['audit_log', entityType, entityId] as const,
};
