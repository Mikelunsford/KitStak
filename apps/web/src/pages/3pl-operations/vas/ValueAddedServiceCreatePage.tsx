import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';

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
    onError: (e) => setError(e instanceof Error ? e.message : 'Failed to create service.'),
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
      <h1 className="text-4xl font-display tracking-wide text-ink">NEW VALUE ADDED SERVICE</h1>
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
          <span className="text-sm text-ink-dim">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
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
        <DollarInput
          label="Base price"
          value={basePriceCents}
          onChange={setBasePriceCents}
          placeholder="0.00"
        />
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Currency (3-letter code)</span>
          <input
            type="text"
            value={currencyCode}
            onChange={(e) => setCurrencyCode(e.target.value.toUpperCase())}
            maxLength={3}
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          <span className="text-sm text-ink-dim">Active</span>
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
