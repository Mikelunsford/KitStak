export const itemsKeys = {
  all: ['sales', 'items'] as const,
  list: (filter?: Record<string, unknown>) =>
    ['sales', 'items', 'list', filter ?? {}] as const,
  byId: (id: string) => ['sales', 'items', 'byId', id] as const,
};
