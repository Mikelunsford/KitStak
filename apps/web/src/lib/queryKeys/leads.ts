/**
 * Lead query keys.
 */
export const leadsKeys = {
  all: ['crm', 'leads'] as const,
  list: (filters: Record<string, unknown> = {}) =>
    ['crm', 'leads', 'list', filters] as const,
  detail: (id: string) => ['crm', 'leads', 'detail', id] as const,
};
