import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { TextInput } from '@/components/ui/TextInput';
import { DollarInput } from '@/components/forms/DollarInput';
import {
  useExpense,
  useExpenseCategoriesList,
  useUpdateExpense,
} from '@/lib/hooks/useExpenses';
import { ExpensePatchSchema } from '@/lib/types/vendors_inventory_ops';
import type { Expense } from '@/lib/types/vendors_inventory_ops';

export function ExpenseEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const query = useExpense(id);
  const update = useUpdateExpense(id ?? '');
  const categories = useExpenseCategoriesList();

  const [expenseDate, setExpenseDate] = useState('');
  const [description, setDescription] = useState('');
  const [amountCents, setAmountCents] = useState<number | null>(0);
  const [currency, setCurrency] = useState('USD');
  const [reimbursable, setReimbursable] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.data) {
      setExpenseDate(query.data.expense_date);
      setDescription(query.data.description ?? '');
      setAmountCents(Number(query.data.amount_cents));
      setCurrency(query.data.currency_code);
      setReimbursable(query.data.reimbursable);
      setCategoryId(query.data.expense_category_id ?? '');
    }
  }, [query.data]);

  const activeCategories = useMemo(
    () => (categories.data ?? []).filter((c) => c.is_active),
    [categories.data],
  );

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const amountInt = amountCents ?? 0;
    const draft = {
      expense_date: expenseDate,
      description: description || null,
      amount_cents: String(amountInt),
      total_cents: String(amountInt),
      currency_code: currency,
      reimbursable,
      ...(categoryId ? { expense_category_id: categoryId } : {}),
    };
    const parsed = ExpensePatchSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('; '));
      return;
    }
    // Zod has validated the shape; cast to the service Partial type.
    const patch: Partial<Expense> = parsed.data as Partial<Expense>;
    update.mutate(patch, {
      onSuccess: () => navigate(`/purchasing/expenses/${id}`),
    });
  }

  if (query.isLoading) {
    return <p className="px-8 py-10 font-sans text-ink-dim">Loading.</p>;
  }
  if (!query.data) {
    return (
      <p className="px-8 py-10 font-sans text-accent">Expense not found.</p>
    );
  }

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6 px-8 py-10">
      <PageHeader title="Edit expense" />
      <form onSubmit={onSubmit} className="flex flex-col gap-4 font-sans">
        <TextInput
          label="Date"
          type="date"
          value={expenseDate}
          onChange={(e) => setExpenseDate(e.target.value)}
          required
        />
        <TextInput
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Category (optional)
          </span>
          <Select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            disabled={categories.isLoading}
          >
            <option value="">
              {categories.isLoading ? 'Loading.' : 'Select a category.'}
            </option>
            {activeCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} {'·'} {c.display_name}
              </option>
            ))}
          </Select>
        </label>
        <DollarInput
          label="Amount"
          value={amountCents}
          onChange={setAmountCents}
        />
        <TextInput
          label="Currency"
          value={currency}
          onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          maxLength={3}
          required
        />
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={reimbursable}
            onChange={(e) => setReimbursable(e.target.checked)}
          />
          <span className="text-sm text-ink">Reimbursable</span>
        </label>
        {error ? <p className="text-accent text-sm">{error}</p> : null}
        {update.error ? (
          <p className="text-accent text-sm">
            {update.error instanceof Error
              ? update.error.message
              : 'Failed to save.'}
          </p>
        ) : null}
        <Button type="submit" disabled={update.isPending} className="self-start">
          {update.isPending ? 'Saving.' : 'Save'}
        </Button>
      </form>
    </section>
  );
}
