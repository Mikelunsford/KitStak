// WmsPutawayCreatePage (Wave 12 Body B Phase B3). Creates a directed putaway
// task: move a quantity of an item into a destination bin. Native useState plus
// Zod safeParse (no react-hook-form). warehouse, item, and quantity are required;
// the destination (suggested / actual) bin and a source receiving-order reference
// are optional. When a receiving order is chosen as the source and no source bin
// is set, the server auto-fills the source from that order's dock. The eyebrow is
// set on this create surface (list + create set the eyebrow; the FSM detail omits
// it).

import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { TextInput } from '@/components/ui/TextInput';
import { Select } from '@/components/ui/Select';
import { ItemPicker } from '@/components/ui/pickers';
import { useWarehousesList } from '@/lib/hooks/useInventory';
import { useWmsLocationsList } from '@/lib/hooks/useWmsLocations';
import { useReceivingOrdersList } from '@/lib/hooks/useOps';
import { useCreateWmsPutaway } from '@/lib/hooks/useWmsPutaway';
import { PutawayTaskCreateSchema } from '@/lib/types/wms';

export function WmsPutawayCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const create = useCreateWmsPutaway();
  const warehouses = useWarehousesList();

  // Deep-link support: launch with ?warehouse_id= to prefill the warehouse.
  const prefilledWarehouseId = searchParams.get('warehouse_id') ?? '';

  const [warehouseId, setWarehouseId] = useState(prefilledWarehouseId);
  const [itemId, setItemId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [suggestedLocationId, setSuggestedLocationId] = useState('');
  const [actualLocationId, setActualLocationId] = useState('');
  const [receivingOrderId, setReceivingOrderId] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  // Destination bins are the live (active, non-deleted) locations in the chosen
  // warehouse. The server validates in-org existence on create regardless.
  const locations = useWmsLocationsList(
    warehouseId ? { warehouse_id: warehouseId, active: true } : {},
  );
  // Source receiving orders: the operator can reference the inbound order this
  // stock arrived on; the server takes its dock as the putaway source.
  const receivingOrders = useReceivingOrdersList();

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!warehouseId) {
      setFormError('Select a warehouse.');
      return;
    }
    if (!itemId) {
      setFormError('Select an item.');
      return;
    }
    // Quantity must be positive: mirror the warehouse / item required-field
    // guards so a zero or negative qty gets a clean client message here instead
    // of hitting the DB quantity > 0 CHECK as an opaque server error.
    if (!(Number(quantity) > 0)) {
      setFormError('Enter a quantity greater than zero.');
      return;
    }

    const parsed = PutawayTaskCreateSchema.safeParse({
      warehouse_id: warehouseId,
      item_id: itemId,
      quantity,
      suggested_location_id: suggestedLocationId || undefined,
      actual_location_id: actualLocationId || undefined,
      // Referencing a receiving order lets the server auto-fill the source dock.
      source_entity_type: receivingOrderId ? 'receiving_order' : undefined,
      source_entity_id: receivingOrderId || undefined,
      notes: notes.trim() ? notes.trim() : undefined,
    });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? 'Check the form and try again.');
      return;
    }

    create.mutate(parsed.data, {
      onSuccess: (t) => {
        navigate(`/wms/putaway/${t.id}`);
      },
    });
  };

  return (
    <section className="px-8 py-12 max-w-xl mx-auto flex flex-col gap-6">
      <PageHeader title="New putaway task" />
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Warehouse
          </span>
          <Select
            value={warehouseId}
            onChange={(e) => {
              setWarehouseId(e.target.value);
              setSuggestedLocationId('');
              setActualLocationId('');
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

        <ItemPicker
          value={itemId}
          onChange={setItemId}
          label="Item (required)"
          filter={{ active: true }}
        />

        <TextInput
          label="Quantity"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          inputMode="decimal"
          required
        />

        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Suggested bin
          </span>
          <Select
            value={suggestedLocationId}
            onChange={(e) => setSuggestedLocationId(e.target.value)}
            aria-label="Suggested bin"
            disabled={!warehouseId}
          >
            <option value="">None</option>
            {(locations.data ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.code}
              </option>
            ))}
          </Select>
        </label>

        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Destination bin
          </span>
          <Select
            value={actualLocationId}
            onChange={(e) => setActualLocationId(e.target.value)}
            aria-label="Destination bin"
            disabled={!warehouseId}
          >
            <option value="">None (set before completing)</option>
            {(locations.data ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.code}
              </option>
            ))}
          </Select>
        </label>

        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Source receiving order
          </span>
          <Select
            value={receivingOrderId}
            onChange={(e) => setReceivingOrderId(e.target.value)}
            aria-label="Source receiving order"
          >
            <option value="">None</option>
            {(receivingOrders.data ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.receiving_number ?? r.reference ?? r.id.slice(0, 8)}
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
            {create.isPending ? 'Saving.' : 'Create putaway task'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate('/wms/putaway')}
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
              : 'Create putaway task failed.'}
          </p>
        )}
      </form>
    </section>
  );
}
