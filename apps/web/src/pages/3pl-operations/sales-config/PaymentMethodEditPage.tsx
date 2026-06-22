// PaymentMethodEditPage. Migration to the shared UI kit (F-Wave10-UI-KIT-01):
// PageHeader + TextInput + Select + kit Button replace the hand-rolled header,
// raw inputs, raw kind select, and raw submit button; a secondary Cancel is
// added. The notes textarea and the Active / Default-for-org checkboxes stay.
// The query hydration, the loading / not-found guards, validation, and the
// submit payload are unchanged.

import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { TextInput } from '@/components/ui/TextInput';
import { paymentMethodsKeys } from '@/lib/queryKeys/paymentMethods';
import {
  getPaymentMethod,
  updatePaymentMethod,
} from '@/lib/services/paymentMethodsService';
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
    mutationFn: (body: PaymentMethodPatch) =>
      updatePaymentMethod(id as string, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: paymentMethodsKeys.all });
      navigate('/settings/sales-config/payment-methods');
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
    return (
      <p className="px-8 py-10 font-sans text-accent">
        Payment method not found.
      </p>
    );
  }

  return (
    <section className="px-8 py-10 max-w-2xl mx-auto flex flex-col gap-6">
      <PageHeader
        title="Edit payment method"
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
            {mutation.isPending ? 'Saving.' : 'Save'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              navigate('/settings/sales-config/payment-methods')
            }
          >
            Cancel
          </Button>
        </div>
      </form>
    </section>
  );
}
