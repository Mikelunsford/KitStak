// AccountCreatePage (Wave 12 Phase A1). Creates a 3PL service-relationship
// account over a CRM customer. Native useState plus Zod safeParse (no
// react-hook-form). customer_id and name are required; account_number is
// optional and the server fills the next ACC- string when it is blank.

import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { TextInput } from '@/components/ui/TextInput';
import { CustomerPicker } from '@/components/ui/pickers';
import { useCreateAccount } from '@/lib/hooks/useAccounts';
import { ThreePlAccountCreateSchema } from '@/lib/types/threepl';

export function AccountCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const create = useCreateAccount();

  // Deep-link support: a customer hub can launch this with ?customer_id= to
  // prefill the relationship pivot.
  const prefilledCustomerId = searchParams.get('customer_id');

  const [customerId, setCustomerId] = useState<string | null>(prefilledCustomerId);
  const [name, setName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!customerId) {
      setFormError('Select a customer.');
      return;
    }

    const parsed = ThreePlAccountCreateSchema.safeParse({
      customer_id: customerId,
      name,
      account_number: accountNumber.trim() ? accountNumber.trim() : undefined,
      notes: notes.trim() ? notes.trim() : undefined,
    });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? 'Check the form and try again.');
      return;
    }

    create.mutate(parsed.data, {
      onSuccess: (r) => {
        navigate(`/3pl-operations/accounts/${r.id}`);
      },
    });
  };

  return (
    <section className="px-8 py-12 max-w-xl mx-auto flex flex-col gap-6">
      <PageHeader title="New account" />
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <CustomerPicker
          value={customerId}
          onChange={setCustomerId}
          label="Customer"
        />
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
          placeholder="Leave blank to auto-assign ACC-"
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
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Saving.' : 'Create account'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate('/3pl-operations/accounts')}
          >
            Cancel
          </Button>
        </div>

        {formError && (
          <p className="font-sans text-sm text-accent">{formError}</p>
        )}
        {create.error && (
          <p className="font-sans text-sm text-accent">
            {create.error instanceof Error
              ? create.error.message
              : 'Create account failed.'}
          </p>
        )}
      </form>
    </section>
  );
}
