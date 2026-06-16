import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { TextInput } from '@/components/ui/TextInput';
import { DollarInput } from '@/components/forms/DollarInput';
import { VendorPicker, ProjectPicker } from '@/components/ui/pickers';
import {
  useCreateExpense,
  useExpenseCategoriesList,
} from '@/lib/hooks/useExpenses';
import type { Expense } from '@/lib/types/vendors_inventory_ops';

const FormSchema = z.object({
  expense_date: z.string().min(1),
  description: z.string().optional(),
  amount_cents: z.number().int().min(0),
  total_cents: z.number().int().min(0),
  currency_code: z.string().length(3),
  reimbursable: z.boolean(),
});

/**
 * ExpenseCreatePage. Closes G-EXP-FORM-01. Wires the three FK pivots the
 * expenses table already supports per ExpenseSchema: expense_category_id
 * (via the category select), vendor_id (via VendorPicker), and project_id
 * (added by migration 0046 and enumerated on ExpenseSchema per
 * F-Wave7-EXPENSE-SCHEMA-01). All three pickers are optional so a quick
 * out-of-pocket expense entry stays one field minimum (date + amount).
 *
 * Reads ?vendor_id= and ?project_id= from the query string so vendor and
 * project detail pages can prefill the new-expense form via deep link.
 */
export function ExpenseCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const create = useCreateExpense();
  const categories = useExpenseCategoriesList();
  const today = new Date().toISOString().slice(0, 10);

  const prefilledVendorId = searchParams.get('vendor_id');
  const prefilledProjectId = searchParams.get('project_id');

  const [date, setDate] = useState(today);
  const [desc, setDesc] = useState('');
  // PR A2: amount holds integer cents via DollarInput.
  const [amount, setAmount] = useState<number | null>(0);
  const [currency, setCurrency] = useState('USD');
  const [reimbursable, setReimbursable] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [vendorId, setVendorId] = useState<string | null>(prefilledVendorId);
  const [projectId, setProjectId] = useState<string | null>(prefilledProjectId);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const activeCategories = useMemo(
    () => (categories.data ?? []).filter((c) => c.is_active),
    [categories.data],
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const amountCentsInt = amount ?? 0;
    const parsed = FormSchema.safeParse({
      expense_date: date,
      description: desc || undefined,
      amount_cents: amountCentsInt,
      total_cents: amountCentsInt,
      currency_code: currency,
      reimbursable,
    });
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      for (const i of parsed.error.issues) fe[String(i.path[0])] = i.message;
      setErrors(fe);
      return;
    }
    setErrors({});
    const body: Partial<Expense> = {
      ...parsed.data,
      description: parsed.data.description ?? null,
    };
    if (categoryId) body.expense_category_id = categoryId;
    if (vendorId) body.vendor_id = vendorId;
    if (projectId) body.project_id = projectId;
    const out = await create.mutateAsync(body);
    navigate(`/purchasing/expenses/${out.id}`);
  }

  return (
    <section className="px-8 py-12 max-w-2xl mx-auto flex flex-col gap-6">
      <PageHeader eyebrow="Purchasing / Expenses" title="New expense" />
      <form
        onSubmit={onSubmit}
        className="flex flex-col gap-4 font-sans text-sm"
      >
        <TextInput
          label="Date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
          {...(errors.expense_date ? { error: errors.expense_date } : {})}
        />
        <TextInput
          label="Description"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
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
        <VendorPicker
          value={vendorId}
          onChange={setVendorId}
          label="Vendor (optional)"
        />
        <ProjectPicker
          value={projectId}
          onChange={setProjectId}
          label="Project (optional)"
        />
        <DollarInput
          label="Amount"
          value={amount}
          onChange={setAmount}
        />
        <TextInput
          label="Currency"
          value={currency}
          onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          maxLength={3}
          required
        />
        <label className="flex gap-2 items-center">
          <input
            type="checkbox"
            checked={reimbursable}
            onChange={(e) => setReimbursable(e.target.checked)}
          />
          <span className="text-ink">Reimbursable</span>
        </label>

        {create.error && (
          <p className="text-accent font-sans text-sm">
            {(create.error as Error).message}
          </p>
        )}

        <div className="flex gap-2">
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Saving.' : 'Save expense'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate('/purchasing/expenses')}
          >
            Cancel
          </Button>
        </div>
      </form>
    </section>
  );
}
