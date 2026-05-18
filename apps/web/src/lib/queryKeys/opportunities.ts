/**
 * Opportunity query keys.
 */
export const opportunitiesKeys = {
  all: ['crm', 'opportunities'] as const,
  list: (filters: Record<string, unknown> = {}) =>
    ['crm', 'opportunities', 'list', filters] as const,
  detail: (id: string) => ['crm', 'opportunities', 'detail', id] as const,
};
