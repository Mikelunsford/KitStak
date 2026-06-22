import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { TextInput } from '@/components/ui/TextInput';
import { useCreateFulfillment, useSalesOrdersList, useCoPackWarehousesList } from '@/lib/hooks/useCoPack';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import type { FulfillmentCreate } from '@/lib/types/copack';

/**
 * FulfillmentCreatePage. Pillar 3. Migrated to the shared UI kit
 * (F-Wave10-UI-KIT-01): PageHeader replaces the hand-rolled h1 and the sales
 * order and warehouse selects use the shared Select primitive.
 *
 * A fulfillment is always opened against a confirmed sales order, so
 * sales_order_id is required. fulfillment_number is auto-assigned by the
 * copack-api handler via next_doc_number when left blank (FUL- prefix). The
 * fulfillment opens in pending; pick/pack/ship advance it on the detail page.
 * There is no copack.fulfillment.create capability, so the create gate reuses
 * copack.fulfillment.pick (the operator who can pick is the operator who can
 * open a fulfillment).
 */
export function FulfillmentCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const create = useCreateFulfillment();
  const orders = useSalesOrdersList();
  const warehouses = useCoPackWarehousesList();
  const caps = useVioCapabilities();

  const [salesOrderId, setSalesOrderId] = useState<string>(
    () => searchParams.get('sales_order_id') ?? '',
  );
  const [fulfillmentNumber, setFulfillmentNumber] = useState('');
  const [warehouseId, setWarehouseId] = useState<string>('');
  const [notes, setNotes] = useState('');

  const orderOptions = useMemo(() => orders.data ?? [], [orders.data]);

  const canCreate = caps.can('copack.fulfillment.pick');

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canCreate || !salesOrderId) return;

    const body: FulfillmentCreate = { sales_order_id: salesOrderId };
    if (fulfillmentNumber.trim()) body.fulfillment_number = fulfillmentNumber.trim();
    if (warehouseId) body.warehouse_id = warehouseId;
    if (notes.trim()) body.notes = notes.trim();

    create.mutate(body, {
      onSuccess: (fulfillment) => {
        navigate(`/copack/fulfillments/${fulfillment.id}`);
      },
    });
  }

  return (
    <section className="px-8 py-12 max-w-2xl mx-auto flex flex-col gap-6">
      <PageHeader title="New fulfillment" />
      {!canCreate ? (
        <p className="text-accent font-sans text-sm">
          You do not have permission to create fulfillments.
        </p>
      ) : null}
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Sales order
          </span>
          <Select
            value={salesOrderId}
            onChange={(e) => setSalesOrderId(e.target.value)}
            disabled={orders.isLoading}
            required
          >
            <option value="">
              {orders.isLoading ? 'Loading.' : 'Select a sales order'}
            </option>
            {orderOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.order_number ?? o.id.slice(0, 8)}
              </option>
            ))}
          </Select>
        </label>
        <TextInput
          label="Fulfillment number (auto-assigned if blank, e.g. FUL-2026-00001)"
          value={fulfillmentNumber}
          onChange={(e) => setFulfillmentNumber(e.target.value)}
        />
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Warehouse (optional)
          </span>
          <Select
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            disabled={warehouses.isLoading}
          >
            <option value="">
              {warehouses.isLoading ? 'Loading.' : 'No warehouse'}
            </option>
            {(warehouses.data ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} · {w.display_name}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
            Notes (optional)
          </span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="bg-bg-2 border border-line text-ink px-4 py-3 font-sans focus:outline-none focus:border-accent"
          />
        </label>

        {create.error ? (
          <p className="text-accent font-sans text-sm">
            {create.error instanceof Error ? create.error.message : 'Create failed.'}
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button type="submit" disabled={!canCreate || !salesOrderId || create.isPending}>
            {create.isPending ? 'Saving.' : 'Create fulfillment'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate('/copack/fulfillments')}
          >
            Cancel
          </Button>
        </div>
      </form>
    </section>
  );
}
