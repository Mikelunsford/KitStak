// Query keys for the 3PL commercial layer. Accounts and their per-account
// service definitions (Phase A1); job templates and their builder lines
// (Phase A2). Mirrors the ops.ts key shape (all / list(filters) / detail(id)).

import type { ListAccountsFilters } from '@/lib/services/accountsService';
import type { ListJobTemplatesFilters } from '@/lib/services/jobTemplatesService';

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

export const jobTemplatesKeys = {
  all: ['threepl', 'job_templates'] as const,
  list: (filters: ListJobTemplatesFilters = {}) =>
    [...jobTemplatesKeys.all, 'list', filters] as const,
  detail: (id: string) => [...jobTemplatesKeys.all, 'detail', id] as const,
};

export const jobTemplateLinesKeys = {
  // Builder lines hang off the parent template's detail key so a parent
  // invalidation sweeps them too.
  byTemplate: (templateId: string) =>
    [...jobTemplatesKeys.detail(templateId), 'lines'] as const,
};
