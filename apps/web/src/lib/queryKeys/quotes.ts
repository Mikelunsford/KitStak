export const quotesKeys = {
  all: ['sales', 'quotes'] as const,
  list: (filter?: Record<string, unknown>) =>
    ['sales', 'quotes', 'list', filter ?? {}] as const,
  byId: (id: string) => ['sales', 'quotes', 'byId', id] as const,
  versions: (id: string) =>
    ['sales', 'quotes', 'byId', id, 'versions'] as const,
};
