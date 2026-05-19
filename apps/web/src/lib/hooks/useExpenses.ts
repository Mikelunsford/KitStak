import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { auditLogKeys } from '@/lib/queryKeys/auditLog';
import { expensesKeys, expenseCategoriesKeys } from '@/lib/queryKeys/expenses';
import {
  listExpenses, getExpense, createExpense, updateExpense, transitionExpense,
  type Expense, type ExpenseStatus,
  type ListExpensesFilters,
} from '@/lib/services/expensesService';
import {
  listExpenseCategories, createExpenseCategory, updateExpenseCategory,
  type ExpenseCategory,
} from '@/lib/services/expenseCategoriesService';

const C = { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 as const };

export function useExpensesList(filters: ListExpensesFilters = {}) {
  return useQuery({
    queryKey: expensesKeys.list(filters),
    queryFn: () => listExpenses(filters),
    ...C,
  });
}

export function useExpense(id: string | undefined) {
  return useQuery({
    queryKey: id ? expensesKeys.detail(id) : ['vendors', 'expenses', 'detail', 'noop'],
    queryFn: () => getExpense(id as string),
    enabled: !!id,
    ...C,
  });
}

export function useCreateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<Expense>) => createExpense(input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: expensesKeys.all }); },
  });
}

export function useUpdateExpense(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<Expense>) => updateExpense(id, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: expensesKeys.all });
      // F-Wave7-AUDIT-CACHE-SWEEP-01: expense updates write an audit row;
      // invalidate the timeline so the detail page reflects new entries.
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('expense', id) });
    },
  });
}

export function useTransitionExpense(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (to: ExpenseStatus) => transitionExpense(id, to),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: expensesKeys.all });
      // F-Wave7-AUDIT-CACHE-SWEEP-01: expense transitions write an audit
      // row via trg_audit_expenses_state; invalidate the timeline so the
      // operator sees the new entry.
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('expense', id) });
    },
  });
}

export function useExpenseCategoriesList() {
  return useQuery({ queryKey: expenseCategoriesKeys.list(), queryFn: listExpenseCategories, ...C });
}

export function useCreateExpenseCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<ExpenseCategory>) => createExpenseCategory(input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: expenseCategoriesKeys.all }); },
  });
}

export function useUpdateExpenseCategory(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<ExpenseCategory>) => updateExpenseCategory(id, input),
    onSuccess: () => { qc.invalidateQueries({ queryKey: expenseCategoriesKeys.all }); },
  });
}
