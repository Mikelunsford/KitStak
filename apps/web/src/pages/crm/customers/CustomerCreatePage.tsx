import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { customersKeys } from '@/lib/queryKeys/customers';
import { createCustomer } from '@/lib/services/customersService';
import {
  CustomerCreateSchema,
  type CustomerCreate,
} from '@/lib/types/crm';

/**
 * Form for new customer. useState + Zod safeParse per the constitution; no
 * react-hook-form.
 */
export function CustomerCreatePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [displayName, setDisplayName] = useState('');
  const [kind, setKind] = useState<'company' | 'individual'>('company');
  const [primaryEmail, setPrimaryEmail] = useState('');
  const [primaryPhone, setPrimaryPhone] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: CustomerCreate) => createCustomer(body),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: customersKeys.all });
      navigate(`/crm/customers/${created.id}`);
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Failed to create.'),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const draft = {
      display_name: displayName,
      kind,
      primary_email: primaryEmail || undefined,
      primary_phone: primaryPhone || undefined,
      tags: [],
    };
    const parsed = CustomerCreateSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('; '));
      return;
    }
    mutation.mutate(parsed.data);
  }

  return (
    <section className="px-8 py-10 max-w-2xl mx-auto flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">
        NEW CUSTOMER
      </h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4 font-sans">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Display name</span>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Kind</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as 'company' | 'individual')}
            className="bg-bg-2 border border-line px-3 py-2"
          >
            <option value="company">Company</option>
            <option value="individual">Individual</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Primary email</span>
          <input
            type="email"
            value={primaryEmail}
            onChange={(e) => setPrimaryEmail(e.target.value)}
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Primary phone</span>
          <input
            type="tel"
            value={primaryPhone}
            onChange={(e) => setPrimaryPhone(e.target.value)}
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        {error ? <p className="text-accent text-sm">{error}</p> : null}
        <button
          type="submit"
          disabled={mutation.isPending}
          className="self-start px-4 py-2 bg-accent text-on-primary font-display tracking-wider disabled:opacity-50"
        >
          {mutation.isPending ? 'CREATING.' : 'CREATE'}
        </button>
      </form>
    </section>
  );
}
