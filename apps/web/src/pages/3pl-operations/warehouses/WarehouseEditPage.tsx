import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { useWarehouse, useUpdateWarehouse } from '@/lib/hooks/useInventory';
import { WarehousePatchSchema } from '@/lib/types/vendors_inventory_ops';
import type { Warehouse } from '@/lib/types/vendors_inventory_ops';

export function WarehouseEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const query = useWarehouse(id);
  const update = useUpdateWarehouse(id ?? '');

  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [city, setCity] = useState('');
  const [region, setRegion] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.data) {
      setCode(query.data.code);
      setDisplayName(query.data.display_name);
      setAddressLine1(query.data.address_line1 ?? '');
      setAddressLine2(query.data.address_line2 ?? '');
      setCity(query.data.city ?? '');
      setRegion(query.data.region ?? '');
      setPostalCode(query.data.postal_code ?? '');
      setCountryCode(query.data.country_code ?? '');
      setIsDefault(query.data.is_default);
      setIsActive(query.data.is_active);
    }
  }, [query.data]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const draft = {
      code,
      display_name: displayName,
      address_line1: addressLine1 || null,
      address_line2: addressLine2 || null,
      city: city || null,
      region: region || null,
      postal_code: postalCode || null,
      country_code: countryCode || null,
      is_default: isDefault,
      is_active: isActive,
    };
    const parsed = WarehousePatchSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join('; '));
      return;
    }
    // Zod has validated the shape; cast to the service Partial type.
    const patch: Partial<Warehouse> = parsed.data as Partial<Warehouse>;
    update.mutate(patch, {
      onSuccess: () => navigate(`/inventory/warehouses/${id}`),
    });
  }

  if (query.isLoading) {
    return <p className="px-8 py-10 font-sans text-ink-dim">Loading.</p>;
  }
  if (!query.data) {
    return <p className="px-8 py-10 font-sans text-accent">Warehouse not found.</p>;
  }

  return (
    <section className="px-8 py-10 max-w-2xl mx-auto flex flex-col gap-6">
      <PageHeader eyebrow="Library / Warehouses" title="Edit warehouse" />
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
          <span className="text-sm text-ink-dim">Display name</span>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Address line 1</span>
          <input
            type="text"
            value={addressLine1}
            onChange={(e) => setAddressLine1(e.target.value)}
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Address line 2</span>
          <input
            type="text"
            value={addressLine2}
            onChange={(e) => setAddressLine2(e.target.value)}
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">City</span>
          <input
            type="text"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Region</span>
          <input
            type="text"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Postal code</span>
          <input
            type="text"
            value={postalCode}
            onChange={(e) => setPostalCode(e.target.value)}
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-ink-dim">Country</span>
          <input
            type="text"
            value={countryCode}
            onChange={(e) => setCountryCode(e.target.value.toUpperCase())}
            maxLength={3}
            className="bg-bg-2 border border-line px-3 py-2"
          />
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
          />
          <span className="text-sm text-ink">Is default</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          <span className="text-sm text-ink">Is active</span>
        </label>
        {error ? <p className="text-accent text-sm">{error}</p> : null}
        {update.error ? (
          <p className="text-accent text-sm">
            {update.error instanceof Error ? update.error.message : 'Failed to save.'}
          </p>
        ) : null}
        <Button
          type="submit"
          variant="primary"
          disabled={update.isPending}
          className="self-start"
        >
          {update.isPending ? 'Saving.' : 'Save'}
        </Button>
      </form>
    </section>
  );
}
