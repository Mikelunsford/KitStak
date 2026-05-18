/**
 * Activity query keys.
 */
export const activitiesKeys = {
  all: ['crm', 'activities'] as const,
  list: (filters: Record<string, unknown> = {}) =>
    ['crm', 'activities', 'list', filters] as const,
  detail: (id: string) => ['crm', 'activities', 'detail', id] as const,
};
