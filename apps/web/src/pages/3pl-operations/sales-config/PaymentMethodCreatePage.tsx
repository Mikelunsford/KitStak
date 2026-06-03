// PaymentMethodCreatePage. Migration to the shared UI kit (F-Wave10-UI-KIT-01):
// PageHeader + TextInput + Select + kit Button replace the hand-rolled header,
// raw inputs, raw kind select, and raw submit button; a secondary Cancel is
// added. The notes textarea and the Active / Default-for-org checkboxes stay (no
// kit equivalents). Validation and the submit payload are unchanged.

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { TextInput } from '@/components/ui/TextInput';
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
    onError: (e) =>
      setError(e instanceof Error ? e.message : 'Failed to create payment method.'),
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
      <PageHeader
        eyebrow="Sales config / Payment methods"
        title="New payment method"
      />
      <form onSubmit={onSubmit} className="flex flex-col gap-4 font-sans">
        <TextInput
          label="Code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
        />
        <TextInput
          label="Label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          required
        />
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Kind
          </span>
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>
            {KIND_OPTIONS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </Select>
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
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Notes
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="bg-bg-2 border border-line text-ink px-4 py-3 font-sans focus:outline-none focus:border-accent"
          />
        </label>
        {error ? <p className="text-accent text-sm">{error}</p> : null}
        <div className="flex gap-3">
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Creating.' : 'Create'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              navigate('/3pl-operations/sales-config/payment-methods')
            }
          >
            Cancel
          </Button>
        </div>
      </form>
    </section>
  );
}
