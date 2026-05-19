import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { useCreateWarehouse } from '@/lib/hooks/useInventory';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';

const FormSchema = z.object({
  code: z.string().min(1, 'Required'),
  display_name: z.string().min(1, 'Required'),
  address_line1: z.string().optional(),
  address_line2: z.string().optional(),
  city: z.string().optional(),
  region: z.string().optional(),
  postal_code: z.string().optional(),
  country_code: z.string().optional(),
  is_default: z.boolean(),
  is_active: z.boolean(),
});

type Errors = Partial<Record<keyof z.infer<typeof FormSchema>, string>>;

export function WarehouseCreatePage() {
  const navigate = useNavigate();
  const caps = useVioCapabilities();
  const create = useCreateWarehouse();

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
  const [errors, setErrors] = useState<Errors>({});

  if (!caps.can('warehouses.warehouse.create')) {
    return (
      <section className="px-8 py-12 max-w-3xl mx-auto flex flex-col gap-6">
        <p className="text-ink">Forbidden.</p>
      </section>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = FormSchema.safeParse({
      code,
      display_name: displayName,
      address_line1: addressLine1,
      address_line2: addressLine2,
      city,
      region,
      postal_code: postalCode,
      country_code: countryCode,
      is_default: isDefault,
      is_active: isActive,
    });
    if (!parsed.success) {
      const fieldErrors: Errors = {};
      for (const issue of parsed.error.issues) {
        fieldErrors[issue.path[0] as keyof Errors] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    const created = await create.mutateAsync({
      code: parsed.data.code,
      display_name: parsed.data.display_name,
      address_line1: parsed.data.address_line1 ? parsed.data.address_line1 : null,
      address_line2: parsed.data.address_line2 ? parsed.data.address_line2 : null,
      city: parsed.data.city ? parsed.data.city : null,
      region: parsed.data.region ? parsed.data.region : null,
      postal_code: parsed.data.postal_code ? parsed.data.postal_code : null,
      country_code: parsed.data.country_code ? parsed.data.country_code : null,
      is_default: parsed.data.is_default,
      is_active: parsed.data.is_active,
    });
    navigate(`/3pl-operations/warehouses/${created.id}`);
  }

  return (
    <section className="px-8 py-12 max-w-3xl mx-auto flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">NEW WAREHOUSE</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4 font-sans text-sm">
        <TextInput
          label="Code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
          {...(errors.code ? { error: errors.code } : {})}
          placeholder="MAIN"
        />
        <TextInput
          label="Display name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
          {...(errors.display_name ? { error: errors.display_name } : {})}
          placeholder="Main Warehouse"
        />
        <TextInput
          label="Address line 1"
          value={addressLine1}
          onChange={(e) => setAddressLine1(e.target.value)}
          {...(errors.address_line1 ? { error: errors.address_line1 } : {})}
        />
        <TextInput
          label="Address line 2"
          value={addressLine2}
          onChange={(e) => setAddressLine2(e.target.value)}
          {...(errors.address_line2 ? { error: errors.address_line2 } : {})}
        />
        <TextInput
          label="City"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          {...(errors.city ? { error: errors.city } : {})}
        />
        <TextInput
          label="Region"
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          {...(errors.region ? { error: errors.region } : {})}
        />
        <TextInput
          label="Postal code"
          value={postalCode}
          onChange={(e) => setPostalCode(e.target.value)}
          {...(errors.postal_code ? { error: errors.postal_code } : {})}
        />
        <TextInput
          label="Country"
          value={countryCode}
          onChange={(e) => setCountryCode(e.target.value.toUpperCase())}
          maxLength={3}
          {...(errors.country_code ? { error: errors.country_code } : {})}
          placeholder="US"
        />
        <label className="flex items-center gap-2 text-ink">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
            className="border border-line bg-bg-2"
          />
          <span>Is default</span>
        </label>
        <label className="flex items-center gap-2 text-ink">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="border border-line bg-bg-2"
          />
          <span>Is active</span>
        </label>

        {create.error ? (
          <p className="text-accent">{create.error instanceof Error ? create.error.message : 'Failed to create warehouse.'}</p>
        ) : null}

        <Button type="submit" disabled={create.isPending} className="self-start">
          {create.isPending ? 'Saving.' : 'Create'}
        </Button>
      </form>
    </section>
  );
}
