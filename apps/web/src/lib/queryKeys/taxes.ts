export const taxesKeys = {
  all: ['sales', 'taxes'] as const,
  list: () => ['sales', 'taxes', 'list'] as const,
  byId: (id: string) => ['sales', 'taxes', 'byId', id] as const,
};
