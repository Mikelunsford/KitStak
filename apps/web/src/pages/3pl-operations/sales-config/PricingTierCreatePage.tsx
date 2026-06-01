import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { PercentInput } from '@/components/forms/PercentInput';
import { pricingTiersKeys } from '@/lib/queryKeys/pricingTiers';
import { createPricingTier } from '@/lib/services/pricingTiersService';
import { PricingTierCreateSchema, type PricingTierCreate } from '@/lib/types/sales';

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
      navigate('/3pl-operations/sales-config/pricing-tiers');
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Failed to create pricing tier.'),
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
      <h1 className="text-4xl font-display tracking-wide text-ink">NEW PRICING TIER</h1>
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
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Sort order</span>
          <input
            type="number"
            inputMode="numeric"
            step={1}
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
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
