/**
 * Org-membership query keys. Shape: ['identity', 'members', ...args].
 *
 * Distinct from `meKeys` (which scopes the caller's own /me payload) and
 * from `tenantsKeys` (which scopes the org row itself). Members queries
 * fan out per-user inside the active org.
 */
export const membersKeys = {
  all: ['identity', 'members'] as const,
  list: (filters: Record<string, unknown> = {}) =>
    ['identity', 'members', 'list', filters] as const,
  detail: (userId: string) =>
    ['identity', 'members', 'detail', userId] as const,
};
