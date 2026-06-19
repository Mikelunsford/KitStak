// Expenses service.

import { apiRequest, apiRequestWithMeta } from '@/lib/apiClient';
import { serverListQs, metaCursor, type ServerListParams } from '@/lib/services/serverListQs';
import { ExpenseSchema, type Expense, type ExpenseStatus } from '@/lib/types/vendors_inventory_ops';

export type { Expense, ExpenseStatus };

const ExpenseListSchema = ExpenseSchema.array();

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

// Workstream C: server-driven list toolbar page (search, sort, keyset). The
// expense list returns its rows in `data` and next_cursor in `meta`, so this
// reads the full envelope via apiRequestWithMeta.
export async function listExpensesPage(
  params: ServerListParams,
): Promise<{ items: Expense[]; next_cursor: string | null }> {
  const env = await apiRequestWithMeta<unknown>(
    `/vendors-api/expenses${serverListQs(params)}`,
    { method: 'GET' },
  );
  return { items: ExpenseListSchema.parse(env.data), next_cursor: metaCursor(env.meta) };
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
