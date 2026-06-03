// ValueAddedServiceCreatePage. Migration to the shared UI kit
// (F-Wave10-UI-KIT-01): PageHeader + TextInput + Select + kit Button replace the
// hand-rolled header, raw inputs, raw kind select, and raw submit button; a
// secondary Cancel is added. The DollarInput (base price), the description
// textarea, and the Active checkbox stay (no kit equivalents). Validation and
// the submit payload are unchanged.

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { TextInput } from '@/components/ui/TextInput';
import { DollarInput } from '@/components/forms/DollarInput';
import { vasKeys } from '@/lib/queryKeys/vas';
import { createValueAddedService } from '@/lib/services/vasService';
import {
  ValueAddedServiceCreateSchema,
  VasKindSchema,
  type ValueAddedServiceCreate,
} from '@/lib/types/sales';

const KIND_OPTIONS = VasKindSchema.options;

export function ValueAddedServiceCreatePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<string>('flat');
  const [basePriceCents, setBasePriceCents] = useState<number | null>(0);
  const [currencyCode, setCurrencyCode] = useState('USD');
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: ValueAddedServiceCreate) => createValueAddedService(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: vasKeys.all });
      navigate('/3pl-operations/vas');
    },
    onError: (e) =>
      setError(e instanceof Error ? e.message : 'Failed to create service.'),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const draft = {
      code: code.trim(),
      name: name.trim(),
      description: description.trim() || null,
      kind,
      base_price_cents: String(basePriceCents ?? 0),
      currency_code: currencyCode.trim().toUpperCase(),
      is_active: isActive,
    };
    const parsed = ValueAddedServiceCreateSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('; '));
      return;
    }
    mutation.mutate(parsed.data);
  }

  return (
    <section className="px-8 py-10 max-w-2xl mx-auto flex flex-col gap-6">
      <PageHeader
        eyebrow="Library / Value added services"
        title="New value added service"
      />
      <form onSubmit={onSubmit} className="flex flex-col gap-4 font-sans">
        <TextInput
          label="Code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
        />
        <TextInput
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Description
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="bg-bg-2 border border-line text-ink px-4 py-3 font-sans focus:outline-none focus:border-accent"
          />
        </label>
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
        <DollarInput
          label="Base price"
          value={basePriceCents}
          onChange={setBasePriceCents}
          placeholder="0.00"
        />
        <TextInput
          label="Currency (3-letter code)"
          value={currencyCode}
          onChange={(e) => setCurrencyCode(e.target.value.toUpperCase())}
          maxLength={3}
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
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Creating.' : 'Create'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate('/3pl-operations/vas')}
          >
            Cancel
          </Button>
        </div>
      </form>
    </section>
  );
}
