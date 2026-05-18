/** Vendors query keys. Shape: [module, entity, ...args]. */
export const vendorsKeys = {
  all: ['vendors', 'vendors'] as const,
  list: () => [...vendorsKeys.all, 'list'] as const,
  detail: (id: string) => [...vendorsKeys.all, 'detail', id] as const,
};
