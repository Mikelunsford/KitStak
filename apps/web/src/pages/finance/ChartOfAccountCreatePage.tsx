import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { AccountTypeSchema } from '@/lib/types/finance';
import { useCreateChartOfAccount } from '@/lib/hooks/useChartOfAccounts';
import type { CoaCreate } from '@/lib/services/chartOfAccountsService'; // cast target

const CoaCreateFormSchema = z.object({
  code: z.string().min(1, 'Code is required'),
  name: z.string().min(1, 'Name is required'),
  account_type: AccountTypeSchema,
  parent_account_id: z.string().uuid().optional(),
  is_active: z.boolean(),
  description: z.string().optional(),
});

/**
 * Form to create a new chart of accounts entry. Wires to POST /coa via
 * useCreateChartOfAccount. Validates with Zod before submitting. System
 * accounts (is_system = true) are managed by the platform; this form only
 * creates custom accounts (is_system is always false on insert).
 */
export function ChartOfAccountCreatePage() {
  const navigate = useNavigate();
  const create = useCreateChartOfAccount();

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [accountType, setAccountType] = useState<z.infer<typeof AccountTypeSchema>>('asset');
  const [isActive, setIsActive] = useState(true);
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const draft = {
      code: code.trim(),
      name: name.trim(),
      account_type: accountType,
      is_active: isActive,
      description: description.trim() || undefined,
    };

    const parsed = CoaCreateFormSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('; '));
      return;
    }

    create.mutate(parsed.data as CoaCreate, {
      onSuccess: () => navigate('/finance/coa'),
      onError: (e) => setError(e instanceof Error ? e.message : 'Failed to create account.'),
    });
  }

  return (
    <section className="px-8 py-10 max-w-2xl mx-auto flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">NEW ACCOUNT</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4 font-sans">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Account code</span>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            placeholder="e.g. 1010"
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Account name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="e.g. Cash"
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Account type</span>
          <select
            value={accountType}
            onChange={(e) =>
              setAccountType(e.target.value as z.infer<typeof AccountTypeSchema>)
            }
            className="bg-bg-2 border border-line px-3 py-2"
          >
            <option value="asset">Asset</option>
            <option value="liability">Liability</option>
            <option value="equity">Equity</option>
            <option value="revenue">Revenue</option>
            <option value="expense">Expense</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Description</span>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional"
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          <span className="text-sm text-ink-dim">Active</span>
        </label>
        {error ? <p className="text-accent text-sm">{error}</p> : null}
        <div className="flex gap-3">
          <button
            type="submit"
            disabled={create.isPending}
            className="px-4 py-2 bg-accent text-on-primary font-display tracking-wider disabled:opacity-50"
          >
            {create.isPending ? 'CREATING.' : 'CREATE'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/finance/coa')}
            className="px-4 py-2 border border-line text-ink-dim font-sans text-sm"
          >
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
