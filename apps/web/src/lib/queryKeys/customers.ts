/**
 * Customer query keys. Shape: ['crm', 'customers', ...args].
 */
export const customersKeys = {
  all: ['crm', 'customers'] as const,
  list: (filters: Record<string, unknown> = {}) =>
    ['crm', 'customers', 'list', filters] as const,
  detail: (id: string) => ['crm', 'customers', 'detail', id] as const,
};
