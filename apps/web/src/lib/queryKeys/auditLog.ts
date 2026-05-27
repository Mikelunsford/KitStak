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
  /**
   * Visited-states projection used by `<StateStepper>` consumers
   * (F-Wave9-COWORK-SMOKE-07). Distinct cache key so the timeline
   * query and the visited-states query don't collide despite both
   * reading from `audit_log` for the same entity.
   */
  visitedStates: (entityType: string, entityId: string) =>
    ['audit_log', entityType, entityId, 'visited_states'] as const,
};
