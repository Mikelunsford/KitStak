// Query keys for the 3PL commercial layer (Wave 12 Phase A1). Accounts and
// their per-account service definitions. Mirrors the ops.ts key shape
// (all / list(filters) / detail(id)).

import type { ListAccountsFilters } from '@/lib/services/accountsService';

export const accountsKeys = {
  all: ['threepl', 'accounts'] as const,
  list: (filters: ListAccountsFilters = {}) =>
    [...accountsKeys.all, 'list', filters] as const,
  detail: (id: string) => [...accountsKeys.all, 'detail', id] as const,
};

export const accountServicesKeys = {
  // Service definitions hang off the parent account's detail key so a parent
  // invalidation sweeps them too.
  byAccount: (accountId: string) =>
    [...accountsKeys.detail(accountId), 'services'] as const,
};
