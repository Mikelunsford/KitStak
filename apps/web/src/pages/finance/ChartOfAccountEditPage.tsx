import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { TextInput } from '@/components/ui/TextInput';
import { AccountTypeSchema } from '@/lib/types/finance';
import {
  useChartOfAccount,
  useUpdateChartOfAccount,
} from '@/lib/hooks/useChartOfAccounts';
import type { CoaPatch } from '@/lib/services/chartOfAccountsService';

const CoaPatchFormSchema = z
  .object({
    code: z.string().min(1, 'Code is required').optional(),
    name: z.string().min(1, 'Name is required').optional(),
    account_type: AccountTypeSchema.optional(),
    is_active: z.boolean().optional(),
    description: z.string().optional(),
  })
  .partial();

/**
 * Edit form for an existing chart of accounts entry. Loads the account by
 * ID, seeds state from the loaded record, then PATCHes via PATCH /coa/:id.
 * System accounts cannot be deleted server-side; this form allows editing
 * name, description, and active flag even for system accounts but does not
 * surface the delete action (handled separately if needed).
 */
export function ChartOfAccountEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const query = useChartOfAccount(id ?? '');
  const update = useUpdateChartOfAccount(id ?? '');

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [accountType, setAccountType] =
    useState<z.infer<typeof AccountTypeSchema>>('asset');
  const [isActive, setIsActive] = useState(true);
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.data) {
      setCode(query.data.code);
      setName(query.data.name);
      setAccountType(query.data.account_type);
      setIsActive(query.data.is_active);
      setDescription(query.data.description ?? '');
    }
  }, [query.data]);

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

    const parsed = CoaPatchFormSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('; '));
      return;
    }

    update.mutate(parsed.data as CoaPatch, {
      onSuccess: () => navigate('/finance/coa'),
      onError: (e) =>
        setError(e instanceof Error ? e.message : 'Failed to save account.'),
    });
  }

  if (query.isLoading) {
    return <p className="px-8 py-10 font-sans text-ink-dim">Loading.</p>;
  }
  if (!query.data) {
    return (
      <p className="px-8 py-10 font-sans text-accent">Account not found.</p>
    );
  }

  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6 px-8 py-10">
      <PageHeader title="Edit account" />
      {query.data.is_system ? (
        <p className="text-sm text-ink-dim font-sans border border-line px-3 py-2 bg-bg-2">
          System account. Code and type are read-only; name, description, and
          active status can be changed.
        </p>
      ) : null}
      <form onSubmit={onSubmit} className="flex flex-col gap-4 font-sans">
        <TextInput
          label="Account code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
          disabled={query.data.is_system}
        />
        <TextInput
          label="Account name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Account type
          </span>
          <Select
            value={accountType}
            onChange={(e) =>
              setAccountType(e.target.value as z.infer<typeof AccountTypeSchema>)
            }
            disabled={query.data.is_system}
          >
            <option value="asset">Asset</option>
            <option value="liability">Liability</option>
            <option value="equity">Equity</option>
            <option value="revenue">Revenue</option>
            <option value="expense">Expense</option>
          </Select>
        </label>
        <TextInput
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional"
        />
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
          <Button type="submit" disabled={update.isPending}>
            {update.isPending ? 'Saving.' : 'Save'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate('/finance/coa')}
          >
            Cancel
          </Button>
        </div>
      </form>
    </section>
  );
}
