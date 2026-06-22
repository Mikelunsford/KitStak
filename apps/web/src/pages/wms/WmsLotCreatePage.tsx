// WmsLotCreatePage (Wave 12 Body B Phase B4). Creates a lot / batch of an item.
// Native useState plus Zod safeParse (no react-hook-form). item_id and lot_code
// are required; expiration_date, received_at, and notes are optional (decision
// (c): lot is always optional and never mandatory in Phase 1). The eyebrow is
// set on this create surface (list + create set the eyebrow; the detail HUB sets
// it too).

import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { TextInput } from '@/components/ui/TextInput';
import { ItemPicker } from '@/components/ui/pickers';
import { useCreateWmsLot } from '@/lib/hooks/useWmsLots';
import { LotCreateSchema } from '@/lib/types/wms';

export function WmsLotCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const create = useCreateWmsLot();

  // Deep-link support: a catalog item hub can launch this with ?item_id= to
  // prefill the item.
  const prefilledItemId = searchParams.get('item_id');

  const [itemId, setItemId] = useState<string | null>(prefilledItemId);
  const [lotCode, setLotCode] = useState('');
  const [expirationDate, setExpirationDate] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!itemId) {
      setFormError('Select an item.');
      return;
    }

    const parsed = LotCreateSchema.safeParse({
      item_id: itemId,
      lot_code: lotCode,
      expiration_date: expirationDate || undefined,
      notes: notes.trim() ? notes.trim() : undefined,
    });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? 'Check the form and try again.');
      return;
    }

    create.mutate(parsed.data, {
      onSuccess: (r) => {
        navigate(`/wms/lots/${r.id}`);
      },
    });
  };

  return (
    <section className="px-8 py-12 max-w-xl mx-auto flex flex-col gap-6">
      <PageHeader title="New lot" />
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <ItemPicker
          value={itemId}
          onChange={setItemId}
          label="Item (required)"
          filter={{ active: true }}
        />

        <TextInput
          label="Lot code"
          value={lotCode}
          onChange={(e) => setLotCode(e.target.value)}
          placeholder="LOT-2026-0001"
          required
        />

        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Expiration date
          </span>
          <input
            type="date"
            value={expirationDate}
            onChange={(e) => setExpirationDate(e.target.value)}
            aria-label="Expiration date"
            className="bg-bg-2 border border-line text-ink px-4 py-3 font-sans focus:outline-none focus:border-accent"
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Notes
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="bg-bg-2 border border-line text-ink px-4 py-3 font-sans focus:outline-none focus:border-accent"
          />
        </label>

        <div className="flex gap-2">
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Saving.' : 'Create lot'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate('/wms/lots')}
          >
            Cancel
          </Button>
        </div>

        {formError && (
          <p className="font-sans text-sm text-accent">{formError}</p>
        )}
        {create.error && (
          <p className="font-sans text-sm text-accent">
            {create.error instanceof Error
              ? create.error.message
              : 'Create lot failed.'}
          </p>
        )}
      </form>
    </section>
  );
}
