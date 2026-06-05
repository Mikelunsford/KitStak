// PricingTierCreatePage. Migration to the shared UI kit (F-Wave10-UI-KIT-01):
// PageHeader + TextInput + kit Button replace the hand-rolled header, raw
// inputs, and raw submit button; a secondary Cancel is added. The PercentInput
// (discount, basis-points round-trip) and the Active checkbox stay. The
// sort-order integer validation and the submit payload are unchanged.

import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { PercentInput } from '@/components/forms/PercentInput';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { TextInput } from '@/components/ui/TextInput';
import { pricingTiersKeys } from '@/lib/queryKeys/pricingTiers';
import { createPricingTier } from '@/lib/services/pricingTiersService';
import {
  PricingTierCreateSchema,
  type PricingTierCreate,
} from '@/lib/types/sales';

export function PricingTierCreatePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [discountBps, setDiscountBps] = useState<number | null>(0);
  const [isActive, setIsActive] = useState(true);
  const [sortOrder, setSortOrder] = useState('0');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: PricingTierCreate) => createPricingTier(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: pricingTiersKeys.all });
      navigate('/settings/sales-config/pricing-tiers');
    },
    onError: (e) =>
      setError(e instanceof Error ? e.message : 'Failed to create pricing tier.'),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsedSort = Number(sortOrder);
    if (!Number.isInteger(parsedSort)) {
      setError('Sort order must be a whole number.');
      return;
    }
    const draft = {
      code: code.trim(),
      name: name.trim(),
      discount_bps: discountBps ?? 0,
      is_active: isActive,
      sort_order: parsedSort,
    };
    const parsed = PricingTierCreateSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('; '));
      return;
    }
    mutation.mutate(parsed.data);
  }

  return (
    <section className="px-8 py-10 max-w-2xl mx-auto flex flex-col gap-6">
      <PageHeader
        eyebrow="Sales config / Pricing tiers"
        title="New pricing tier"
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
        <PercentInput
          label="Discount"
          value={discountBps}
          onChange={setDiscountBps}
          placeholder="0.00"
        />
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          <span className="text-sm text-ink-dim">Active</span>
        </label>
        <TextInput
          label="Sort order"
          type="number"
          inputMode="numeric"
          step={1}
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
        />
        {error ? <p className="text-accent text-sm">{error}</p> : null}
        <div className="flex gap-3">
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Creating.' : 'Create'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              navigate('/settings/sales-config/pricing-tiers')
            }
          >
            Cancel
          </Button>
        </div>
      </form>
    </section>
  );
}
