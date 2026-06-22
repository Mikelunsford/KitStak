import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { TextInput } from '@/components/ui/TextInput';
import { CustomerPicker, ProjectPicker, ChannelPicker } from '@/components/ui/pickers';
import { CurrencyField } from '@/components/ui/CurrencyField';
import { useCreateSalesOrder } from '@/lib/hooks/useCoPack';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import type { SalesOrderCreate } from '@/lib/types/copack';

/**
 * SalesOrderCreatePage. Pillar 3. Migrated to the shared UI kit
 * (F-Wave10-UI-KIT-01): PageHeader replaces the hand-rolled h1 and the channel
 * select uses the shared Select primitive.
 *
 * All fields optional: order_number auto-assigned by the copack-api handler via
 * next_doc_number when left blank (SO- prefix). The order opens in draft; lines
 * are added on the detail page. datetime-local is coerced to ISO before posting
 * so the Iso zod schema accepts it.
 */
function localToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function SalesOrderCreatePage() {
  const navigate = useNavigate();
  const create = useCreateSalesOrder();
  const caps = useVioCapabilities();

  const [orderNumber, setOrderNumber] = useState('');
  const [channelId, setChannelId] = useState<string>('');
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [currency, setCurrency] = useState('USD');
  const [orderedAt, setOrderedAt] = useState('');
  const [notes, setNotes] = useState('');

  const canCreate = caps.can('copack.order.create');

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canCreate) return;

    const body: SalesOrderCreate = {};
    if (orderNumber.trim()) body.order_number = orderNumber.trim();
    if (channelId) body.channel_id = channelId;
    if (customerId) body.customer_id = customerId;
    if (projectId) body.project_id = projectId;
    if (currency.trim().length === 3) body.currency_code = currency.trim().toUpperCase();
    const orderedIso = localToIso(orderedAt);
    if (orderedIso) body.ordered_at = orderedIso;
    if (notes.trim()) body.notes = notes.trim();

    create.mutate(body, {
      onSuccess: (order) => {
        navigate(`/copack/orders/${order.id}`);
      },
    });
  }

  return (
    <section className="px-8 py-12 max-w-2xl mx-auto flex flex-col gap-6">
      <PageHeader title="New sales order" />
      {!canCreate ? (
        <p className="text-accent font-sans text-sm">
          You do not have permission to create sales orders.
        </p>
      ) : null}
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <TextInput
          label="Order number (auto-assigned if blank, e.g. SO-2026-00001)"
          value={orderNumber}
          onChange={(e) => setOrderNumber(e.target.value)}
        />
        <ChannelPicker
          value={channelId || null}
          onChange={(id) => setChannelId(id ?? '')}
          label="Channel (optional)"
        />
        <CustomerPicker
          value={customerId}
          onChange={setCustomerId}
          label="Customer (optional)"
        />
        <ProjectPicker
          value={projectId}
          onChange={setProjectId}
          label="Project (optional)"
        />
        <TextInput
          label="Ordered at"
          type="datetime-local"
          value={orderedAt}
          onChange={(e) => setOrderedAt(e.target.value)}
        />
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

        <details className="border border-line bg-bg-2/40">
          <summary className="px-4 py-2 cursor-pointer text-sm text-ink-dim tracking-wide uppercase">
            Advanced (optional)
          </summary>
          <div className="flex flex-col gap-4 p-4 border-t border-line">
            <CurrencyField value={currency} onChange={setCurrency} />
          </div>
        </details>

        {create.error ? (
          <p className="text-accent font-sans text-sm">
            {create.error instanceof Error ? create.error.message : 'Create failed.'}
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button type="submit" disabled={!canCreate || create.isPending}>
            {create.isPending ? 'Saving.' : 'Create draft'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate('/copack/orders')}
          >
            Cancel
          </Button>
        </div>
      </form>
    </section>
  );
}
