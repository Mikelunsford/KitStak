// WmsLocationCreatePage (Wave 12 Body B Phase B1). Creates a warehouse location
// (bin / shelf / rack / dock / staging). Native useState plus Zod safeParse (no
// react-hook-form). warehouse_id, code, and location_type are required.
// parent_location_id is optional and the operator picks it from the existing
// locations in the chosen warehouse.

import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { TextInput } from '@/components/ui/TextInput';
import { Select } from '@/components/ui/Select';
import { useWarehousesList } from '@/lib/hooks/useInventory';
import { useWmsLocationsList, useCreateWmsLocation } from '@/lib/hooks/useWmsLocations';
import {
  WarehouseLocationCreateSchema,
  type WarehouseLocationType,
} from '@/lib/types/wms';

const LOCATION_TYPES: ReadonlyArray<WarehouseLocationType> = [
  'bin',
  'shelf',
  'rack',
  'dock',
  'staging',
];

export function WmsLocationCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const create = useCreateWmsLocation();
  const warehouses = useWarehousesList();

  // Deep-link support: a warehouse hub can launch this with ?warehouse_id= to
  // prefill the parent warehouse.
  const prefilledWarehouseId = searchParams.get('warehouse_id') ?? '';

  const [warehouseId, setWarehouseId] = useState(prefilledWarehouseId);
  const [code, setCode] = useState('');
  const [locationType, setLocationType] = useState<WarehouseLocationType>('bin');
  const [parentLocationId, setParentLocationId] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  // Parent options are the existing live (active, non-deleted) locations in the
  // chosen warehouse. Scoped to active so a new location is not parented under a
  // deactivated one. The server validates in-org existence on create regardless.
  const parents = useWmsLocationsList(
    warehouseId ? { warehouse_id: warehouseId, active: true } : {},
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!warehouseId) {
      setFormError('Select a warehouse.');
      return;
    }

    const parsed = WarehouseLocationCreateSchema.safeParse({
      warehouse_id: warehouseId,
      code,
      location_type: locationType,
      parent_location_id: parentLocationId || undefined,
      notes: notes.trim() ? notes.trim() : undefined,
    });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? 'Check the form and try again.');
      return;
    }

    create.mutate(parsed.data, {
      onSuccess: (r) => {
        navigate(`/wms/locations/${r.id}`);
      },
    });
  };

  return (
    <section className="px-8 py-12 max-w-xl mx-auto flex flex-col gap-6">
      <PageHeader title="New location" />
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Warehouse
          </span>
          <Select
            value={warehouseId}
            onChange={(e) => {
              setWarehouseId(e.target.value);
              setParentLocationId('');
            }}
            aria-label="Warehouse"
          >
            <option value="">Select a warehouse</option>
            {(warehouses.data ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.display_name} ({w.code})
              </option>
            ))}
          </Select>
        </label>

        <TextInput
          label="Code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="A-01-02-03"
          required
        />

        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Type
          </span>
          <Select
            value={locationType}
            onChange={(e) =>
              setLocationType(e.target.value as WarehouseLocationType)
            }
            aria-label="Location type"
          >
            {LOCATION_TYPES.map((t) => (
              <option key={t} value={t} className="capitalize">
                {t}
              </option>
            ))}
          </Select>
        </label>

        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Parent location
          </span>
          <Select
            value={parentLocationId}
            onChange={(e) => setParentLocationId(e.target.value)}
            aria-label="Parent location"
            disabled={!warehouseId}
          >
            <option value="">None</option>
            {(parents.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.code}
              </option>
            ))}
          </Select>
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
            {create.isPending ? 'Saving.' : 'Create location'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate('/wms/locations')}
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
              : 'Create location failed.'}
          </p>
        )}
      </form>
    </section>
  );
}
