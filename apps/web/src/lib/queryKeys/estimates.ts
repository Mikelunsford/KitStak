export const estimatesKeys = {
  all: ['estimate', 'estimates'] as const,
  list: () => ['estimate', 'estimates', 'list'] as const,
  byId: (id: string) => ['estimate', 'estimates', 'byId', id] as const,
};
