/**
 * Chart of accounts query keys.
 */

export const chartOfAccountKeys = {
  all: ['finance', 'coa'] as const,
  list: () => ['finance', 'coa', 'list'] as const,
  detail: (id: string) => ['finance', 'coa', 'detail', id] as const,
};
