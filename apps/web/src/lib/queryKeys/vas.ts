export const vasKeys = {
  all: ['sales', 'vas'] as const,
  list: () => ['sales', 'vas', 'list'] as const,
  byId: (id: string) => ['sales', 'vas', 'byId', id] as const,
};
