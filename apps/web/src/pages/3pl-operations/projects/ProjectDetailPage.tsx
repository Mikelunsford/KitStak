import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { ItemPicker } from '@/components/ui/pickers';
import {
  useProject, useTransitionProject, useCreatePhase,
  useTransitionPhase, useReorderPhases,
  useProjectLineItems, useAddProjectLineItem, useRemoveProjectLineItem,
  useConvertProjectToInvoice,
} from '@/lib/hooks/useProjects';
import { useCustomer } from '@/lib/hooks/useCustomer';
import { useItem } from '@/lib/hooks/useItems';
import { useQuote } from '@/lib/hooks/useQuotes';
import { useInvoices } from '@/lib/hooks/useInvoices';
import { useReceivingOrdersList, useShipmentsList } from '@/lib/hooks/useOps';
import {
  PROJECT_FSM, PROJECT_PHASE_FSM, canTransition,
  type ProjectState, type ProjectPhaseState,
} from '@/lib/workflow/sales';
import { formatCents } from '@/lib/money';

const PROJECT_TARGETS: ProjectState[] = [
  'pending', 'ready_to_build', 'in_production',
  'ready_to_ship', 'completed', 'cancelled',
];

const PHASE_TARGETS: ProjectPhaseState[] = [
  'pending', 'active', 'completed', 'cancelled',
];

/**
 * ProjectDetailPage. The integration hub for the quote-to-cash chain.
 * Surfaces customer, source quote breadcrumb, line items / materials (BOM),
 * receiving orders bound to the project, shipments bound to the project,
 * invoices bound to the project, and the "convert to invoice" action on
 * completion. Closes G-PROJECT-DETAIL-01.
 *
 * Receiving and shipment filtering is client-side until Agent 6.5-B adds
 * project_id columns (G-RECV-FK-01, G-SHIP-FK-01) and the list endpoints
 * grow the corresponding filter. Until then the filter is opportunistic and
 * relies on the read-only `project_id` field if 6.5-B ships it as part of
 * the type extension; otherwise this section renders the empty-state.
 */
export function ProjectDetailPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const projectId = id ?? '';
  const { data, isLoading, error } = useProject(id);
  const transition = useTransitionProject(projectId);
  const createPhase = useCreatePhase(projectId);
  const transitionPhase = useTransitionPhase(projectId);
  const reorder = useReorderPhases(projectId);
  const addLine = useAddProjectLineItem(projectId);
  const removeLine = useRemoveProjectLineItem(projectId);
  const convertToInvoice = useConvertProjectToInvoice(projectId);

  const customerId = data?.project.customer_id ?? null;
  const sourceQuoteId = data?.project.source_quote_id ?? null;

  const customer = useCustomer(customerId ?? undefined);
  const sourceQuote = useQuote(sourceQuoteId ?? undefined);
  const lineItems = useProjectLineItems(projectId);
  const invoices = useInvoices({});
  const receiving = useReceivingOrdersList();
  const shipments = useShipmentsList();

  const [phaseName, setPhaseName] = useState('');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [materialName, setMaterialName] = useState('');
  const [materialQty, setMaterialQty] = useState('1');
  const [materialPrice, setMaterialPrice] = useState('0');

  const selectedItem = useItem(selectedItemId ?? undefined);

  if (isLoading) return <p className="p-8 text-ink-dim">Loading.</p>;
  if (error || !data) return <p className="p-8 text-accent">Project not found.</p>;

  const { project, phases } = data;
  const state = project.state as ProjectState;

  const onPickItem = (itemId: string | null) => {
    setSelectedItemId(itemId);
    if (itemId && selectedItem.data) {
      setMaterialName(selectedItem.data.name);
      setMaterialPrice(String(selectedItem.data.unit_price_cents));
    }
  };

  const onAddPhase = async (e: FormEvent) => {
    e.preventDefault();
    if (!projectId) return;
    await createPhase.mutateAsync({ name: phaseName });
    setPhaseName('');
  };

  const onAddMaterial = async (e: FormEvent) => {
    e.preventDefault();
    if (!projectId) return;
    await addLine.mutateAsync({
      name: materialName,
      item_id: selectedItemId,
      quantity: materialQty,
      unit_price_cents: materialPrice,
      discount_percent: 0,
    });
    setSelectedItemId(null);
    setMaterialName('');
    setMaterialQty('1');
    setMaterialPrice('0');
  };

  const movePhase = (index: number, delta: number) => {
    const next = phases.map((p) => p.id);
    const newIndex = index + delta;
    if (newIndex < 0 || newIndex >= next.length) return;
    const aId = next[index];
    const bId = next[newIndex];
    if (aId === undefined || bId === undefined) return;
    next[index] = bId;
    next[newIndex] = aId;
    reorder.mutate({ phase_ids: next });
  };

  const onConvertToInvoice = async () => {
    const result = await convertToInvoice.mutateAsync();
    if (result?.invoice_id) {
      navigate(`/invoicing/invoices/${result.invoice_id}`);
    }
  };

  const projectInvoices = (invoices.data ?? []).filter(
    (inv) => inv.project_id === projectId,
  );

  // TODO 6.5-A: receiving / shipment project_id filtering is best-effort
  // until 6.5-B adds the column + list-filter support. The Receiving and
  // Shipment side-car schemas today have no project_id field; we read it via
  // a duck-typed cast so the section is harmlessly empty pre-migration and
  // populates once the column lands.
  const projectReceiving = (receiving.data ?? []).filter(
    (r) => (r as unknown as { project_id?: string | null }).project_id === projectId,
  );
  const projectShipments = (shipments.data ?? []).filter(
    (s) => (s as unknown as { project_id?: string | null }).project_id === projectId,
  );

  return (
    <section className="px-8 py-12 max-w-5xl mx-auto flex flex-col gap-8">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-4xl font-display tracking-wide text-ink">{project.number}</h1>
          <p className="text-ink-dim">{project.name}</p>
          <div className="text-ink-dim text-sm mt-2 flex flex-col gap-1">
            {customerId && (
              <span>
                Customer:{' '}
                <Link
                  to={`/crm/customers/${customerId}`}
                  className="text-ink hover:text-accent"
                >
                  {customer.data?.display_name ?? customerId}
                </Link>
              </span>
            )}
            {sourceQuoteId && (
              <span>
                Source quote:{' '}
                <Link
                  to={`/3pl-operations/quotes/${sourceQuoteId}`}
                  className="text-ink hover:text-accent"
                >
                  {sourceQuote.data?.quote.number ?? sourceQuoteId}
                </Link>
              </span>
            )}
            <span className="font-mono">
              Budget: {formatCents(project.budget_cents, project.currency_code)}
            </span>
          </div>
        </div>
        <span className="px-3 py-1 border border-line font-mono text-sm">{state}</span>
      </header>

      <div className="flex flex-wrap gap-2">
        {PROJECT_TARGETS
          .filter((to) => to !== state && canTransition(PROJECT_FSM, state, to))
          .map((to) => (
            <Button key={to} variant="secondary" onClick={() => transition.mutate({ to })}>
              Move to {to.replace(/_/g, ' ')}
            </Button>
          ))}
        {state === 'completed' && (
          <Button
            onClick={onConvertToInvoice}
            disabled={convertToInvoice.isPending}
          >
            {convertToInvoice.isPending ? 'Creating invoice.' : 'Create invoice'}
          </Button>
        )}
      </div>

      <section>
        <h2 className="text-2xl font-display tracking-wider text-ink mb-3">MATERIALS</h2>
        {lineItems.isLoading ? (
          <p className="text-ink-dim text-sm">Loading materials.</p>
        ) : lineItems.error ? (
          <p className="text-ink-dim text-sm">No materials yet.</p>
        ) : (
          <table className="w-full border border-line">
            <thead className="bg-bg-2 text-left text-sm font-display tracking-wider text-ink">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Qty</th>
                <th className="px-4 py-2">Unit price</th>
                <th className="px-4 py-2">Total</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {(lineItems.data ?? []).length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-3 text-ink-dim text-sm">
                    No materials yet.
                  </td>
                </tr>
              ) : (
                (lineItems.data ?? []).map((l) => {
                  const qty = Number(l.quantity);
                  const unit = Number(l.unit_price_cents);
                  const discount = Number(l.discount_percent);
                  const subtotal = Math.round(qty * unit * (1 - discount / 100));
                  return (
                  <tr key={l.id} className="border-t border-line">
                    <td className="px-4 py-2">{l.name}</td>
                    <td className="px-4 py-2 font-mono text-sm">
                      {qty.toFixed(2)}
                    </td>
                    <td className="px-4 py-2 font-mono text-sm">
                      {formatCents(l.unit_price_cents, project.currency_code)}
                    </td>
                    <td className="px-4 py-2 font-mono text-sm">
                      {formatCents(subtotal, project.currency_code)}
                    </td>
                    <td className="px-4 py-2">
                      {['pending', 'ready_to_build'].includes(state) && (
                        <Button
                          variant="ghost"
                          onClick={() => removeLine.mutate(l.id)}
                        >
                          Remove
                        </Button>
                      )}
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}

        {['pending', 'ready_to_build'].includes(state) && (
          <form
            onSubmit={onAddMaterial}
            className="flex flex-col gap-3 border border-line p-4 mt-4"
          >
            <h3 className="font-display tracking-wider text-ink">ADD MATERIAL</h3>
            <ItemPicker
              value={selectedItemId}
              onChange={onPickItem}
              label="Item (pre-fills name and price)"
              filter={{ active: true }}
            />
            <div className="flex gap-3 flex-wrap items-end">
              <TextInput
                label="Name"
                value={materialName}
                onChange={(e) => setMaterialName(e.target.value)}
                required
              />
              <TextInput
                label="Quantity"
                value={materialQty}
                onChange={(e) => setMaterialQty(e.target.value)}
                inputMode="decimal"
              />
              <TextInput
                label="Unit price (cents)"
                value={materialPrice}
                onChange={(e) => setMaterialPrice(e.target.value)}
                inputMode="numeric"
              />
              <Button type="submit">Add material</Button>
            </div>
          </form>
        )}
      </section>

      <section>
        <h2 className="text-2xl font-display tracking-wider text-ink mb-3">PHASES</h2>
        <ol className="flex flex-col gap-3">
          {phases.map((phase, index) => {
            const ps = phase.state as ProjectPhaseState;
            return (
              <li
                key={phase.id}
                className="bg-bg-2 border border-line p-4 flex items-center justify-between gap-4"
              >
                <div className="flex flex-col">
                  <span className="text-ink font-display tracking-wider">{phase.name}</span>
                  <span className="text-ink-dim text-sm font-mono">{ps}</span>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button
                    variant="ghost"
                    onClick={() => movePhase(index, -1)}
                    disabled={index === 0}
                  >
                    Up
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => movePhase(index, 1)}
                    disabled={index === phases.length - 1}
                  >
                    Down
                  </Button>
                  {PHASE_TARGETS
                    .filter((to) => to !== ps && canTransition(PROJECT_PHASE_FSM, ps, to))
                    .map((to) => (
                      <Button
                        key={to}
                        variant="secondary"
                        onClick={() =>
                          transitionPhase.mutate({ phaseId: phase.id, body: { to } })
                        }
                      >
                        {to}
                      </Button>
                    ))}
                </div>
              </li>
            );
          })}
        </ol>

        <form onSubmit={onAddPhase} className="flex gap-3 items-end mt-4">
          <TextInput
            label="New phase name"
            value={phaseName}
            onChange={(e) => setPhaseName(e.target.value)}
            required
          />
          <Button type="submit">Add phase</Button>
        </form>
      </section>

      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-2xl font-display tracking-wider text-ink">RECEIVING</h2>
          <Link
            to={`/3pl-operations/receiving/new?project_id=${projectId}`}
            className="text-sm text-accent hover:text-accent-bright"
          >
            New receiving order
          </Link>
        </div>
        {projectReceiving.length === 0 ? (
          <p className="text-ink-dim text-sm">No receiving orders against this project.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {projectReceiving.map((r) => (
              <li key={r.id} className="border border-line p-3">
                <Link
                  to={`/3pl-operations/receiving/${r.id}`}
                  className="text-ink hover:text-accent font-mono text-sm"
                >
                  {r.receiving_number ?? r.id}
                </Link>
                <span className="text-ink-dim text-sm ml-3">{r.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-2xl font-display tracking-wider text-ink">SHIPMENTS</h2>
          <Link
            to={`/3pl-operations/shipments/new?project_id=${projectId}`}
            className="text-sm text-accent hover:text-accent-bright"
          >
            New shipment
          </Link>
        </div>
        {projectShipments.length === 0 ? (
          <p className="text-ink-dim text-sm">No shipments against this project.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {projectShipments.map((s) => (
              <li key={s.id} className="border border-line p-3">
                <Link
                  to={`/3pl-operations/shipments/${s.id}`}
                  className="text-ink hover:text-accent font-mono text-sm"
                >
                  {s.shipment_number ?? s.id}
                </Link>
                <span className="text-ink-dim text-sm ml-3">{s.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-2xl font-display tracking-wider text-ink">INVOICES</h2>
          {state === 'completed' && (
            <Button onClick={onConvertToInvoice} disabled={convertToInvoice.isPending}>
              {convertToInvoice.isPending ? 'Creating.' : 'Create invoice from project'}
            </Button>
          )}
        </div>
        {projectInvoices.length === 0 ? (
          <p className="text-ink-dim text-sm">No invoices against this project.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {projectInvoices.map((inv) => (
              <li key={inv.id} className="border border-line p-3">
                <Link
                  to={`/invoicing/invoices/${inv.id}`}
                  className="text-ink hover:text-accent font-mono text-sm"
                >
                  {inv.invoice_number}
                </Link>
                <span className="text-ink-dim text-sm ml-3">
                  {inv.status} · {formatCents(inv.balance_cents, inv.currency_code)} due
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-2">
        <h2 className="text-2xl font-display tracking-wide text-ink mb-3">HISTORY</h2>
        <AuditTimeline entityType="project" entityId={id ?? null} />
      </section>
    </section>
  );
}
