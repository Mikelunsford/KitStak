// TaxEditPage. Migration to the shared UI kit (F-Wave10-UI-KIT-01): PageHeader +
// TextInput + kit Button replace the hand-rolled header, raw inputs, and raw
// submit button; a secondary Cancel is added. The PercentInput (rate), the
// notes textarea, and the Compound / Active / Default-for-org checkboxes stay.
// The query hydration, the loading / not-found guards, validation, and the
// submit payload are unchanged.

import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { PercentInput } from '@/components/forms/PercentInput';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { TextInput } from '@/components/ui/TextInput';
import { taxesKeys } from '@/lib/queryKeys/taxes';
import { getTax, updateTax } from '@/lib/services/taxesService';
import { TaxPatchSchema, type TaxPatch } from '@/lib/types/sales';

export function TaxEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: taxesKeys.byId(id as string),
    queryFn: () => getTax(id as string),
    enabled: Boolean(id),
  });

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [rateBps, setRateBps] = useState<number | null>(null);
  const [isCompound, setIsCompound] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [defaultForOrg, setDefaultForOrg] = useState(false);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.data) {
      setCode(query.data.code);
      setName(query.data.name);
      setRateBps(query.data.rate_bps);
      setIsCompound(query.data.is_compound);
      setIsActive(query.data.is_active);
      setDefaultForOrg(query.data.default_for_org);
      setNotes(query.data.notes ?? '');
    }
  }, [query.data]);

  const mutation = useMutation({
    mutationFn: (body: TaxPatch) => updateTax(id as string, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: taxesKeys.all });
      navigate('/settings/sales-config/taxes');
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Failed to save.'),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const draft = {
      code: code.trim(),
      name: name.trim(),
      rate_bps: rateBps ?? 0,
      is_compound: isCompound,
      is_active: isActive,
      default_for_org: defaultForOrg,
      notes: notes.trim() || null,
    };
    const parsed = TaxPatchSchema.safeParse(draft);
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
    return <p className="px-8 py-10 font-sans text-accent">Tax not found.</p>;
  }

  return (
    <section className="px-8 py-10 max-w-2xl mx-auto flex flex-col gap-6">
      <PageHeader title="Edit tax" />
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
        <PercentInput
          label="Rate"
          value={rateBps}
          onChange={setRateBps}
          required
          placeholder="0.00"
        />
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isCompound}
            onChange={(e) => setIsCompound(e.target.checked)}
          />
          <span className="text-sm text-ink-dim">Compound tax</span>
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
            onClick={() => navigate('/settings/sales-config/taxes')}
          >
            Cancel
          </Button>
        </div>
      </form>
    </section>
  );
}
