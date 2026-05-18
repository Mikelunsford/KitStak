// Expenses service.

import { apiRequest } from '@/lib/apiClient';
import { ExpenseSchema, type Expense, type ExpenseStatus } from '@/lib/types/vendors_inventory_ops';

export type { Expense, ExpenseStatus };

export async function listExpenses(): Promise<Expense[]> {
  const data = await apiRequest<unknown>('/vendors-api/expenses', { method: 'GET' });
  return (data as Expense[]).map((r) => ExpenseSchema.parse(r));
}

export async function getExpense(id: string): Promise<Expense> {
  const data = await apiRequest<unknown>(`/vendors-api/expenses/${id}`, { method: 'GET' });
  return ExpenseSchema.parse(data);
}

export async function createExpense(input: Partial<Expense>): Promise<Expense> {
  const data = await apiRequest<unknown>('/vendors-api/expenses', { method: 'POST', body: input });
  return ExpenseSchema.parse(data);
}

export async function updateExpense(id: string, input: Partial<Expense>): Promise<Expense> {
  const data = await apiRequest<unknown>(`/vendors-api/expenses/${id}`, { method: 'PATCH', body: input });
  return ExpenseSchema.parse(data);
}

export async function transitionExpense(id: string, to: ExpenseStatus): Promise<Expense> {
  const data = await apiRequest<unknown>(
    `/vendors-api/expenses/${id}/transition`,
    { method: 'POST', body: { to } },
  );
  return ExpenseSchema.parse(data);
}
