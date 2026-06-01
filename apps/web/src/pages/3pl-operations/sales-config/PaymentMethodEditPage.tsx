import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { paymentMethodsKeys } from '@/lib/queryKeys/paymentMethods';
import { getPaymentMethod, updatePaymentMethod } from '@/lib/services/paymentMethodsService';
import {
  PaymentMethodKindSchema,
  PaymentMethodPatchSchema,
  type PaymentMethodPatch,
} from '@/lib/types/sales';

const KIND_OPTIONS = PaymentMethodKindSchema.options;

export function PaymentMethodEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: paymentMethodsKeys.byId(id as string),
    queryFn: () => getPaymentMethod(id as string),
    enabled: Boolean(id),
  });

  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<string>('manual');
  const [isActive, setIsActive] = useState(true);
  const [defaultForOrg, setDefaultForOrg] = useState(false);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.data) {
      setCode(query.data.code);
      setLabel(query.data.label);
      setKind(query.data.kind);
      setIsActive(query.data.is_active);
      setDefaultForOrg(query.data.default_for_org);
      setNotes(query.data.notes ?? '');
    }
  }, [query.data]);

  const mutation = useMutation({
    mutationFn: (body: PaymentMethodPatch) => updatePaymentMethod(id as string, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: paymentMethodsKeys.all });
      navigate('/3pl-operations/sales-config/payment-methods');
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Failed to save.'),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const draft = {
      code: code.trim(),
      label: label.trim(),
      kind,
      is_active: isActive,
      default_for_org: defaultForOrg,
      notes: notes.trim() || null,
    };
    const parsed = PaymentMethodPatchSchema.safeParse(draft);
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
    return <p className="px-8 py-10 font-sans text-accent">Payment method not found.</p>;
  }

  return (
    <section className="px-8 py-10 max-w-2xl mx-auto flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">EDIT PAYMENT METHOD</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4 font-sans">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Code</span>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Label</span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            required
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Kind</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="bg-bg-2 border border-line px-3 py-2"
          >
            {KIND_OPTIONS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          <span className="text-sm text-ink-dim">Active</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={defaultForOrg}
            onChange={(e) => setDefaultForOrg(e.target.checked)}
          />
          <span className="text-sm text-ink-dim">Default for org</span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
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
