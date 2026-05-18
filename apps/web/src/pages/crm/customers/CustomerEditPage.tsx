import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useCustomer } from '@/lib/hooks/useCustomer';
import { customersKeys } from '@/lib/queryKeys/customers';
import { updateCustomer } from '@/lib/services/customersService';
import {
  CustomerPatchSchema,
  type CustomerPatch,
} from '@/lib/types/crm';

export function CustomerEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const query = useCustomer(id);

  const [displayName, setDisplayName] = useState('');
  const [primaryEmail, setPrimaryEmail] = useState('');
  const [primaryPhone, setPrimaryPhone] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.data) {
      setDisplayName(query.data.display_name);
      setPrimaryEmail(query.data.primary_email ?? '');
      setPrimaryPhone(query.data.primary_phone ?? '');
    }
  }, [query.data]);

  const mutation = useMutation({
    mutationFn: (body: CustomerPatch) => updateCustomer(id as string, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: customersKeys.all });
      navigate(`/crm/customers/${id}`);
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Failed to save.'),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const draft = {
      display_name: displayName,
      primary_email: primaryEmail || null,
      primary_phone: primaryPhone || null,
    };
    const parsed = CustomerPatchSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('; '));
      return;
    }
    mutation.mutate(parsed.data);
  }

  if (query.isLoading) {
    return <p className="px-8 py-10 font-sans text-ink-dim">Loading.</p>;
  }
  if (!query.data) {
    return <p className="px-8 py-10 font-sans text-accent">Customer not found.</p>;
  }

  return (
    <section className="px-8 py-10 max-w-2xl mx-auto flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">EDIT CUSTOMER</h1>
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
          {mutation.isPending ? 'SAVING.' : 'SAVE'}
        </button>
      </form>
    </section>
  );
}
