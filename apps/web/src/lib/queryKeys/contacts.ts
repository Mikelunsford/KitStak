/**
 * Contact query keys.
 */
export const contactsKeys = {
  all: ['crm', 'contacts'] as const,
  list: (filters: Record<string, unknown> = {}) =>
    ['crm', 'contacts', 'list', filters] as const,
  detail: (id: string) => ['crm', 'contacts', 'detail', id] as const,
};
