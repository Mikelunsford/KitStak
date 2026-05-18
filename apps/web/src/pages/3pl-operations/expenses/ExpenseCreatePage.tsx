import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { useCreateExpense } from '@/lib/hooks/useExpenses';

const FormSchema = z.object({
  expense_date: z.string().min(1),
  description: z.string().optional(),
  amount_cents: z.number().int().min(0),
  total_cents: z.number().int().min(0),
  currency_code: z.string().length(3),
  reimbursable: z.boolean(),
});

export function ExpenseCreatePage() {
  const navigate = useNavigate();
  const create = useCreateExpense();
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState(0);
  const [currency, setCurrency] = useState('USD');
  const [reimbursable, setReimbursable] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = FormSchema.safeParse({
      expense_date: date,
      description: desc || undefined,
      amount_cents: amount,
      total_cents: amount,
      currency_code: currency,
      reimbursable,
    });
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      for (const i of parsed.error.issues) fe[String(i.path[0])] = i.message;
      setErrors(fe);
      return;
    }
    const out = await create.mutateAsync({
      ...parsed.data,
      description: parsed.data.description ?? null,
    });
    navigate(`/3pl-operations/expenses/${out.id}`);
  }

  return (
    <section className="px-8 py-12 max-w-2xl mx-auto flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">NEW EXPENSE</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4 font-sans text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-ink-dim">Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border border-line bg-bg-2 px-3 py-2 text-ink" />
          {errors.expense_date ? <span className="text-accent text-xs">{errors.expense_date}</span> : null}
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-ink-dim">Description</span>
          <input value={desc} onChange={(e) => setDesc(e.target.value)} className="border border-line bg-bg-2 px-3 py-2 text-ink" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-ink-dim">Amount (cents)</span>
          <input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="border border-line bg-bg-2 px-3 py-2 text-ink" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-ink-dim">Currency</span>
          <input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} className="border border-line bg-bg-2 px-3 py-2 text-ink" />
        </label>
        <label className="flex gap-2 items-center">
          <input type="checkbox" checked={reimbursable} onChange={(e) => setReimbursable(e.target.checked)} />
          <span className="text-ink">Reimbursable</span>
        </label>
        <button type="submit" disabled={create.isPending} className="self-start px-4 py-2 bg-accent text-on-primary">
          {create.isPending ? 'Saving.' : 'Create'}
        </button>
      </form>
    </section>
  );
}
