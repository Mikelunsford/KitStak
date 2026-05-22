import { lazy, Suspense, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import { fallbackLabel } from '@/components/shell/breadcrumbFallback';
import { NextStepCTA } from '@/components/shell/NextStepCTA';
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
import { shouldShowProjectNextStepCTA } from '@/lib/workflow/nextStepCTA';
import { formatCents } from '@/lib/money';
import { destructiveConfirm } from '@/lib/destructiveConfirm';
import type { ProjectPhase } from '@/lib/types/sales';

// F-Wave2-DNDKIT-01: drag-and-drop phase reorder lives in its own lazy
// chunk so that `@dnd-kit/*` (roughly 13 kB gzipped) does not push the
// main SPA index chunk over the 40 kB bundle cap. The Suspense fallback
// renders a static Up / Down version of the same list so the section is
// never blank while the chunk loads.
const PhasesSection = lazy(() =>
  import('./PhasesSection').then((m) => ({ default: m.PhasesSection })),
);

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

  const onAddPhase = (e: FormEvent) => {
    e.preventDefault();
    if (!projectId) return;
    // F-Wave7-MUTATION-ERRORS-SWEEP-01: switch from await mutateAsync
    // (which leaves the form silently broken on 4xx) to the onSuccess
    // callback so the mutation.error state is preserved and rendered
    // inline below.
    createPhase.mutate(
      { name: phaseName },
      {
        onSuccess: () => {
          setPhaseName('');
        },
      },
    );
  };

  const onAddMaterial = (e: FormEvent) => {
    e.preventDefault();
    if (!projectId) return;
    addLine.mutate(
      {
        name: materialName,
        item_id: selectedItemId,
        quantity: materialQty,
        unit_price_cents: materialPrice,
        discount_percent: 0,
      },
      {
        onSuccess: () => {
          setSelectedItemId(null);
          setMaterialName('');
          setMaterialQty('1');
          setMaterialPrice('0');
        },
      },
    );
  };

  // Static fallback for the Suspense boundary on the PHASES section.
  // Runs Up / Down only (no dnd-kit) so the section stays interactive
  // while the lazy chunk for PhasesSection loads.
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

  const onConvertToInvoice = () => {
    // F-Wave7-MUTATION-ERRORS-SWEEP-01: switch from await mutateAsync to
    // the onSuccess callback so a 4xx surfaces in the inline error renderer
    // below instead of swallowing the result.
    convertToInvoice.mutate(undefined, {
      onSuccess: (result) => {
        if (result?.invoice_id) {
          navigate(`/invoicing/invoices/${result.invoice_id}`);
        }
      },
    });
  };

  const projectInvoices = (invoices.data ?? []).filter(
    (inv) => inv.project_id === projectId,
  );

  // Receiving and Shipment side-car schemas do not carry a project_id field
  // today, so the filter reads it via a duck-typed cast. The section stays
  // harmlessly empty until the column lands and the schemas extend.
  const projectReceiving = (receiving.data ?? []).filter(
    (r) => (r as unknown as { project_id?: string | null }).project_id === projectId,
  );
  const projectShipments = (shipments.data ?? []).filter(
    (s) => (s as unknown as { project_id?: string | null }).project_id === projectId,
  );

  return (
    <section className="px-8 py-12 max-w-5xl mx-auto flex flex-col gap-8">
      <Breadcrumbs
        items={[
          { label: 'Customers', to: '/crm/customers' },
          ...(customerId
            ? [
                {
                  label: fallbackLabel(customer.data?.display_name, customerId),
                  to: `/crm/customers/${customerId}`,
                },
              ]
            : []),
          ...(sourceQuoteId
            ? [
                { label: 'Quotes', to: '/3pl-operations/quotes' },
                {
                  label: fallbackLabel(
                    sourceQuote.data?.quote.number,
                    sourceQuoteId,
                  ),
                  to: `/3pl-operations/quotes/${sourceQuoteId}`,
                },
              ]
            : []),
          { label: 'Projects', to: '/3pl-operations/projects' },
          { label: project.number },
        ]}
      />
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
                {/*
                  PR-6 / B11: operator reported this link appeared red on
                  the smoke walk. Investigation: the resting className is
                  `text-ink hover:text-accent` (identical to the customer
                  link two lines up), and there is no conditional class
                  override anywhere. The "red" observation was the hover
                  state (accent is #c8102e). No code change needed beyond
                  the data-testid below so the next smoke pass can target
                  the element precisely (resting vs hover) and avoid the
                  same false positive.
                */}
                <Link
                  to={`/3pl-operations/quotes/${sourceQuoteId}`}
                  className="text-ink hover:text-accent"
                  data-testid="source-quote-link"
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

      {/* UX-Q4: forward-transition CTA promoted to primary top placement
          when state === 'ready_to_ship'. Predicate lives in
          `@/lib/workflow/nextStepCTA` so the regression test can lock the
          trigger state. Deep-links to the create-shipment form with
          project_id pre-filled (ShipmentCreatePage already reads this
          query param). */}
      {shouldShowProjectNextStepCTA(state) && (
        <NextStepCTA
          label="Create shipment"
          to={`/3pl-operations/shipments/new?project_id=${projectId}`}
        />
      )}

      {/* Secondary cluster of FSM transitions. The new primary CTA above
          replaces the equal-weight "Move to <state>" button that would
          have read "Move to completed" from ready_to_ship; the other
          targets stay so the operator can still complete or cancel. */}
      <div className="flex flex-wrap gap-2">
        {PROJECT_TARGETS
          .filter((to) => to !== state && canTransition(PROJECT_FSM, state, to))
          .map((to) => (
            <Button
              key={to}
              variant="secondary"
              onClick={() => {
                // UX-Q8: only the cancelled transition is destructive.
                // Other targets ('pending', 'ready_to_build',
                // 'in_production', 'ready_to_ship', 'completed') are
                // forward movements through the project lifecycle.
                if (to === 'cancelled' && !destructiveConfirm({
                  action: 'Cancel this project',
                  consequence: 'The project will move to cancelled and stop appearing in active work lists.',
                })) return;
                transition.mutate({ to });
              }}
            >
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
                label="Unit price (whole cents, e.g. 250 = $2.50)"
                value={materialPrice}
                onChange={(e) => setMaterialPrice(e.target.value)}
                inputMode="numeric"
              />
              <Button type="submit" disabled={addLine.isPending}>
                {addLine.isPending ? 'Adding.' : 'Add material'}
              </Button>
            </div>
            {addLine.isError && (
              <p className="text-accent font-sans text-sm">
                Add material failed:{' '}
                {addLine.error instanceof Error ? addLine.error.message : 'unknown error'}
              </p>
            )}
          </form>
        )}
      </section>

      <section>
        <h2 className="text-2xl font-display tracking-wider text-ink mb-3">PHASES</h2>
        <Suspense
          fallback={
            <PhasesFallback
              phases={phases}
              movePhase={movePhase}
              transitionPhase={transitionPhase}
            />
          }
        >
          <PhasesSection
            phases={phases}
            reorder={reorder}
            transitionPhase={transitionPhase}
          />
        </Suspense>

        <form onSubmit={onAddPhase} className="flex flex-col gap-2 mt-4">
          <div className="flex gap-3 items-end">
            <TextInput
              label="New phase name"
              value={phaseName}
              onChange={(e) => setPhaseName(e.target.value)}
              required
            />
            <Button type="submit" disabled={createPhase.isPending}>
              {createPhase.isPending ? 'Adding.' : 'Add phase'}
            </Button>
          </div>
          {createPhase.error && (
            <p className="font-sans text-sm text-accent">
              {createPhase.error instanceof Error
                ? createPhase.error.message
                : 'Add phase failed.'}
            </p>
          )}
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
        {convertToInvoice.error && (
          <p className="font-sans text-sm text-accent mb-3">
            {convertToInvoice.error instanceof Error
              ? convertToInvoice.error.message
              : 'Create invoice failed.'}
          </p>
        )}
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

/**
 * Static Up / Down version of the phases list, used as the Suspense
 * fallback for the lazy PhasesSection (F-Wave2-DNDKIT-01). Renders the
 * exact same card layout without dnd-kit so the section is never blank
 * while the lazy chunk loads. Also serves as the accessibility baseline
 * if dnd-kit's keyboard sensor ever fails: Up / Down buttons stay in
 * the live tree even after PhasesSection mounts.
 */
function PhasesFallback({
  phases, movePhase, transitionPhase,
}: {
  phases: ProjectPhase[];
  movePhase: (index: number, delta: number) => void;
  transitionPhase: ReturnType<typeof useTransitionPhase>;
}) {
  return (
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
  );
}
