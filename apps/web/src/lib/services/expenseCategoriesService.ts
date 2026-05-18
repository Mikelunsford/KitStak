// Expense categories service.

import { apiRequest } from '@/lib/apiClient';
import { ExpenseCategorySchema, type ExpenseCategory } from '@/lib/types/vendors_inventory_ops';

export type { ExpenseCategory };

export async function listExpenseCategories(): Promise<ExpenseCategory[]> {
  const data = await apiRequest<unknown>('/vendors-api/expense-categories', { method: 'GET' });
  return (data as ExpenseCategory[]).map((r) => ExpenseCategorySchema.parse(r));
}

export async function createExpenseCategory(input: Partial<ExpenseCategory>): Promise<ExpenseCategory> {
  const data = await apiRequest<unknown>(
    '/vendors-api/expense-categories', { method: 'POST', body: input },
  );
  return ExpenseCategorySchema.parse(data);
}

export async function updateExpenseCategory(id: string, input: Partial<ExpenseCategory>): Promise<ExpenseCategory> {
  const data = await apiRequest<unknown>(
    `/vendors-api/expense-categories/${id}`, { method: 'PATCH', body: input },
  );
  return ExpenseCategorySchema.parse(data);
}
