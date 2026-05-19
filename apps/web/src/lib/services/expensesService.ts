// Expenses service.

import { apiRequest } from '@/lib/apiClient';
import { ExpenseSchema, type Expense, type ExpenseStatus } from '@/lib/types/vendors_inventory_ops';

export type { Expense, ExpenseStatus };

export type ListExpensesFilters = {
  vendor_id?: string;
  project_id?: string;
};

function expensesQs(f: ListExpensesFilters): string {
  const p = new URLSearchParams();
  if (f.vendor_id) p.set('vendor_id', f.vendor_id);
  if (f.project_id) p.set('project_id', f.project_id);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function listExpenses(
  filters: ListExpensesFilters = {},
): Promise<Expense[]> {
  const data = await apiRequest<unknown>(
    `/vendors-api/expenses${expensesQs(filters)}`,
    { method: 'GET' },
  );
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
