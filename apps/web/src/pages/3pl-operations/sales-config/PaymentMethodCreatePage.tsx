import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { paymentMethodsKeys } from '@/lib/queryKeys/paymentMethods';
import { createPaymentMethod } from '@/lib/services/paymentMethodsService';
import {
  PaymentMethodCreateSchema,
  PaymentMethodKindSchema,
  type PaymentMethodCreate,
} from '@/lib/types/sales';

const KIND_OPTIONS = PaymentMethodKindSchema.options;

export function PaymentMethodCreatePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<string>('manual');
  const [isActive, setIsActive] = useState(true);
  const [defaultForOrg, setDefaultForOrg] = useState(false);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: PaymentMethodCreate) => createPaymentMethod(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: paymentMethodsKeys.all });
      navigate('/3pl-operations/sales-config/payment-methods');
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Failed to create payment method.'),
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
    const parsed = PaymentMethodCreateSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('; '));
      return;
    }
    mutation.mutate(parsed.data);
  }

  return (
    <section className="px-8 py-10 max-w-2xl mx-auto flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">NEW PAYMENT METHOD</h1>
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
          {mutation.isPending ? 'CREATING.' : 'CREATE'}
        </button>
      </form>
    </section>
  );
}
