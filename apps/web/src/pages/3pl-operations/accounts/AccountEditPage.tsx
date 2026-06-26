// AccountEditPage (Wave 15). Edits a 3PL account header (name, account number,
// notes) over the already-live useUpdateAccount hook. Native useState plus Zod
// safeParse, mirroring AccountCreatePage. customer_id is the immutable
// relationship pivot and is not editable here; status moves via the
// deactivate / reactivate actions on the detail page, so it is omitted too.

import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { TextInput } from '@/components/ui/TextInput';
import { useAccount, useUpdateAccount } from '@/lib/hooks/useAccounts';
import { ThreePlAccountPatchSchema } from '@/lib/types/threepl';

export function AccountEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const query = useAccount(id);
  const update = useUpdateAccount(id ?? '');

  const [name, setName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (query.data) {
      setName(query.data.name);
      setAccountNumber(query.data.account_number ?? '');
      setNotes(query.data.notes ?? '');
    }
  }, [query.data]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const parsed = ThreePlAccountPatchSchema.safeParse({
      name,
      account_number: accountNumber.trim() ? accountNumber.trim() : null,
      notes: notes.trim() ? notes.trim() : null,
    });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? 'Check the form and try again.');
      return;
    }

    update.mutate(parsed.data, {
      onSuccess: () => navigate(`/3pl-operations/accounts/${id}`),
    });
  };

  if (query.isLoading) {
    return <p className="px-8 py-10 font-sans text-ink-dim">Loading.</p>;
  }
  if (!query.data) {
    return <p className="px-8 py-10 font-sans text-accent">Account not found.</p>;
  }

  return (
    <section className="px-8 py-12 max-w-xl mx-auto flex flex-col gap-6">
      <PageHeader title="Edit account" />
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <TextInput
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <TextInput
          label="Account number"
          value={accountNumber}
          onChange={(e) => setAccountNumber(e.target.value)}
        />
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Notes
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="bg-bg-2 border border-line text-ink px-4 py-3 font-sans focus:outline-none focus:border-accent"
          />
        </label>

        <div className="flex gap-2">
          <Button type="submit" disabled={update.isPending}>
            {update.isPending ? 'Saving.' : 'Save account'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate(`/3pl-operations/accounts/${id}`)}
          >
            Cancel
          </Button>
        </div>

        {formError && (
          <p className="font-sans text-sm text-accent">{formError}</p>
        )}
        {update.error && (
          <p className="font-sans text-sm text-accent">
            {update.error instanceof Error
              ? update.error.message
              : 'Save account failed.'}
          </p>
        )}
      </form>
    </section>
  );
}
