export const projectsKeys = {
  all: ['sales', 'projects'] as const,
  list: (filter?: Record<string, unknown>) =>
    ['sales', 'projects', 'list', filter ?? {}] as const,
  byId: (id: string) => ['sales', 'projects', 'byId', id] as const,
};
