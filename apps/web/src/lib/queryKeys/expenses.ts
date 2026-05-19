import type { ListExpensesFilters } from '@/lib/services/expensesService';

export const expensesKeys = {
  all: ['vendors', 'expenses'] as const,
  list: (filters: ListExpensesFilters = {}) =>
    [...expensesKeys.all, 'list', filters] as const,
  detail: (id: string) => [...expensesKeys.all, 'detail', id] as const,
};

export const expenseCategoriesKeys = {
  all: ['vendors', 'expense_categories'] as const,
  list: () => [...expenseCategoriesKeys.all, 'list'] as const,
};
