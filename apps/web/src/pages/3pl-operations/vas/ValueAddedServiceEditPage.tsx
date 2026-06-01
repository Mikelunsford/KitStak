import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { DollarInput } from '@/components/forms/DollarInput';
import { vasKeys } from '@/lib/queryKeys/vas';
import { getValueAddedService, updateValueAddedService } from '@/lib/services/vasService';
import {
  ValueAddedServicePatchSchema,
  VasKindSchema,
  type ValueAddedServicePatch,
} from '@/lib/types/sales';

const KIND_OPTIONS = VasKindSchema.options;

export function ValueAddedServiceEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: vasKeys.byId(id as string),
    queryFn: () => getValueAddedService(id as string),
    enabled: Boolean(id),
  });

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<string>('flat');
  const [basePriceCents, setBasePriceCents] = useState<number | null>(null);
  const [currencyCode, setCurrencyCode] = useState('USD');
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.data) {
      setCode(query.data.code);
      setName(query.data.name);
      setDescription(query.data.description ?? '');
      setKind(query.data.kind);
      const cents = query.data.base_price_cents;
      setBasePriceCents(typeof cents === 'string' ? Number(cents) : cents);
      setCurrencyCode(query.data.currency_code);
      setIsActive(query.data.is_active);
    }
  }, [query.data]);

  const mutation = useMutation({
    mutationFn: (body: ValueAddedServicePatch) => updateValueAddedService(id as string, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: vasKeys.all });
      navigate('/3pl-operations/vas');
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Failed to save.'),
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
    const parsed = ValueAddedServicePatchSchema.safeParse(draft);
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
    return <p className="px-8 py-10 font-sans text-accent">Service not found.</p>;
  }

  return (
    <section className="px-8 py-10 max-w-2xl mx-auto flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">EDIT VALUE ADDED SERVICE</h1>
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
          {mutation.isPending ? 'SAVING.' : 'SAVE'}
        </button>
      </form>
    </section>
  );
}
