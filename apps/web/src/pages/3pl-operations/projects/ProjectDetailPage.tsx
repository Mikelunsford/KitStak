// ProjectDetailPage. Migration to the shared UI kit (F-Wave10-UI-KIT-01, 3PL
// CRUD tail): PageHeader replaces the hand-rolled header (number title plus
// name / customer / source-quote / budget meta), DetailLayout moves HISTORY
// into the right rail, and the MATERIALS table becomes a DataTable (the
// roundHalfEven subtotal lives in the Total column render, the per-row Remove
// in an actions column gated on the editable states).
//
// Everything else is preserved verbatim: the FSM transition cluster, the
// NextStepCTA, the lazy PhasesSection plus its Suspense fallback (dnd-kit stays
// out of the index chunk per F-Wave2-DNDKIT-01), the receiving / manufacturing
// / shipments / invoices sub-sections with their server-side project_id filters
// and defense-in-depth client filters, the convert-to-invoice action, and the
// source-quote-link data-testid.

import { Suspense, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { lazyWithReload as lazy } from '@/lib/lazyWithReload';

import { Package, Layers, Truck, Inbox, Factory, FileText } from 'lucide-react';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import { fallbackLabel } from '@/components/shell/breadcrumbFallback';
import { DetailSectionEmptyCoaching } from '@/components/shell/DetailSectionEmptyCoaching';
import { NextStepCTA } from '@/components/shell/NextStepCTA';
import { StateStepper } from '@/components/shell/StateStepper';
import {
  STATE_STEPPER_PATHS,
  isOffPath,
} from '@/lib/workflow/stateStepperPaths';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { PageHeader } from '@/components/ui/PageHeader';
import { DetailLayout } from '@/components/ui/DetailLayout';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { DollarInput } from '@/components/forms/DollarInput';
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
import { useManufacturingRunsList } from '@/lib/hooks/useManufacturing';
import {
  buildManufacturingRunDetailUrl,
  buildNewManufacturingRunUrl,
  buildNewShipmentUrl,
  buildShipmentDetailUrl,
} from './projectChildLinks';
import {
  PROJECT_FSM, PROJECT_PHASE_FSM, canTransition,
  type ProjectState, type ProjectPhaseState,
} from '@/lib/workflow/sales';
import { shouldShowProjectNextStepCTA } from '@/lib/workflow/nextStepCTA';
import { formatCents, roundHalfEven } from '@/lib/money';
import { destructiveConfirm } from '@/lib/destructiveConfirm';
import type {
  JobTemplateSnapshotLine, ProjectLineItem, ProjectPhase,
} from '@/lib/types/sales';

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
 * Receiving is now a typed FK + server-side filter as of UX-Q6
 * (migration 0061, ReceivingOrderSchema gained `project_id`, ops-api
 * GET /receiving-orders accepts ?project_id=). Shipment filtering
 * remains client-side until the matching shipments-API filter ships;
 * see F-Wave9-UX-Q6-SHIPMENT-LIST-FILTER-01 for the symmetry follow-up.
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
  // UX-Q6: server-side filter via the new ?project_id= param on
  // GET /receiving-orders. ReceivingOrderSchema now carries project_id
  // natively so the prior duck-typed cast is no longer required.
  const receiving = useReceivingOrdersList(
    projectId ? { project_id: projectId } : {},
  );
  // F-Wave9-AUDIT-V3-WAVE-C4-01: server-side filter via the new ?project_id=
  // param on GET /shipments and GET /manufacturing-runs. ShipmentSchema
  // and ManufacturingRunSchema now both carry project_id natively (C2 /
  // PR #133) and the list endpoints filter by it. Replaces the prior
  // duck-typed client-side cast on shipments and adds the missing
  // manufacturing-runs section.
  const shipments = useShipmentsList(
    projectId ? { project_id: projectId } : {},
  );
  const manufacturingRuns = useManufacturingRunsList(
    projectId ? { project_id: projectId } : {},
  );

  const [phaseName, setPhaseName] = useState('');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [materialName, setMaterialName] = useState('');
  const [materialQty, setMaterialQty] = useState('1');
  // PR A2: integer cents via DollarInput; quantity remains a plain decimal
  // string because the project line-item schema uses `quantity` (decimal)
  // not `quantity_e3`.
  const [materialPrice, setMaterialPrice] = useState<number | null>(0);

  const selectedItem = useItem(selectedItemId ?? undefined);

  if (isLoading) return <p className="p-8 text-ink-dim">Loading.</p>;
  if (error || !data) return <p className="p-8 text-accent">Project not found.</p>;

  const { project, phases } = data;
  const state = project.state as ProjectState;

  // Wave 12 / A4: the Job Builder template this project was built from, plus the
  // frozen snapshot captured at conversion. The snapshot is the historical
  // record (later template edits never change it); the link points at the live
  // template for context. Both are null for projects not built from a template.
  const sourceTemplateId = project.source_job_template_id ?? null;
  const templateSnapshot = project.job_template_snapshot ?? null;
  const templateLabel =
    templateSnapshot?.template_number ?? templateSnapshot?.name ?? sourceTemplateId;

  // Compact "qty N @ $rate" summary for a frozen snapshot line; unpriced step
  // lines read "no rate". Currency falls back to the project's when the line did
  // not snapshot its own.
  const snapshotLineSummary = (l: JobTemplateSnapshotLine): string => {
    const parts: string[] = [];
    if (l.quantity != null) parts.push(`qty ${Number(l.quantity)}`);
    if (l.rate_cents != null) {
      parts.push(formatCents(l.rate_cents, l.currency_code ?? project.currency_code));
    }
    return parts.length > 0 ? parts.join(' @ ') : 'no rate';
  };

  const onPickItem = (itemId: string | null) => {
    setSelectedItemId(itemId);
    if (itemId && selectedItem.data) {
      setMaterialName(selectedItem.data.name);
      setMaterialPrice(Number(selectedItem.data.unit_price_cents));
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
        unit_price_cents: String(materialPrice ?? 0),
        discount_percent: 0,
      },
      {
        onSuccess: () => {
          setSelectedItemId(null);
          setMaterialName('');
          setMaterialQty('1');
          setMaterialPrice(0);
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

  // UX-Q6: ReceivingOrderSchema now carries `project_id` natively. The
  // hook above already passes ?project_id= so this is a pass-through;
  // the redundant client-side check guards against a stale cache or a
  // future hook-level cache mix.
  const projectReceiving = (receiving.data ?? []).filter(
    (r) => r.project_id === projectId,
  );
  // F-Wave9-AUDIT-V3-WAVE-C4-01: ShipmentSchema now carries `project_id`
  // natively (C2 / PR #133) and the hook above passes ?project_id= so
  // this is a pass-through; the redundant client-side check guards
  // against a stale cache or a future hook-level cache mix.
  const projectShipments = (shipments.data ?? []).filter(
    (s) => s.project_id === projectId,
  );
  // F-Wave9-AUDIT-V3-WAVE-C4-01: manufacturing_runs.project_id wired by
  // C2 / PR #133. Same defense-in-depth filter shape as shipments.
  const projectManufacturingRuns = (manufacturingRuns.data ?? []).filter(
    (r) => r.project_id === projectId,
  );

  const materialActionColumn: DataColumn<ProjectLineItem>[] = [
    'pending',
    'ready_to_build',
  ].includes(state)
    ? [
        {
          key: 'actions',
          header: '',
          align: 'right',
          render: (l) => (
            <Button variant="ghost" onClick={() => removeLine.mutate(l.id)}>
              Remove
            </Button>
          ),
        },
      ]
    : [];

  const materialColumns: ReadonlyArray<DataColumn<ProjectLineItem>> = [
    { key: 'name', header: 'Name', render: (l) => l.name },
    {
      key: 'qty',
      header: 'Qty',
      align: 'right',
      cellClassName: 'font-mono',
      render: (l) => Number(l.quantity).toFixed(2),
    },
    {
      key: 'unit',
      header: 'Unit price',
      align: 'right',
      cellClassName: 'font-mono',
      render: (l) => formatCents(l.unit_price_cents, project.currency_code),
    },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      cellClassName: 'font-mono',
      render: (l) => {
        const qty = Number(l.quantity);
        const unit = Number(l.unit_price_cents);
        const discount = Number(l.discount_percent);
        const subtotal = roundHalfEven(qty * unit * (1 - discount / 100));
        return formatCents(subtotal, project.currency_code);
      },
    },
    ...materialActionColumn,
  ];

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-8 px-8 py-12">
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
                { label: 'Quotes', to: '/quotes' },
                {
                  label: fallbackLabel(
                    sourceQuote.data?.quote.number,
                    sourceQuoteId,
                  ),
                  to: `/quotes/${sourceQuoteId}`,
                },
              ]
            : []),
          { label: 'Projects', to: '/projects' },
          { label: project.number },
        ]}
      />

      {/* UX-Q7: display-only horizontal progress stepper. Sits above the
          PageHeader to match the migrated FSM detail pages and the reference
          InvoiceDetailPage. */}
      <StateStepper
        steps={[...STATE_STEPPER_PATHS.project.path]}
        current={state}
        offPath={
          isOffPath('project', state)
            ? { state, label: STATE_STEPPER_PATHS.project.resolveLabel(state) }
            : undefined
        }
      />

      <PageHeader
        title={project.number}
        meta={
          <span className="flex flex-col gap-1">
            <span>{project.name}</span>
            {customerId && (
              <span>
                Customer:{' '}
                <Link
                  to={`/crm/customers/${customerId}`}
                  className="text-ink hover:text-accent"
                >
                  {fallbackLabel(customer.data?.display_name, customerId)}
                </Link>
              </span>
            )}
            {sourceQuoteId && (
              <span>
                Source quote:{' '}
                {/*
                  PR-6 / B11: operator reported this link appeared red on
                  the smoke walk. The resting className is `text-ink
                  hover:text-accent`; the "red" was the hover state (accent
                  is #c8102e). The data-testid lets the next smoke pass
                  target resting vs hover precisely.
                */}
                <Link
                  to={`/quotes/${sourceQuoteId}`}
                  className="text-ink hover:text-accent"
                  data-testid="source-quote-link"
                >
                  {fallbackLabel(sourceQuote.data?.quote.number, sourceQuoteId)}
                </Link>
              </span>
            )}
            {sourceTemplateId && (
              <span>
                Built from template:{' '}
                <Link
                  to={`/3pl-operations/job-builders/${sourceTemplateId}`}
                  className="text-ink hover:text-accent"
                  data-testid="source-template-link"
                >
                  {templateLabel}
                </Link>
              </span>
            )}
            <span className="font-mono">
              Budget: {formatCents(project.budget_cents, project.currency_code)}
            </span>
          </span>
        }
      />

      <DetailLayout
        rail={
          <section>
            <h2 className="mb-3 text-2xl font-display tracking-wide text-ink">
              HISTORY
            </h2>
            <AuditTimeline entityType="project" entityId={id ?? null} />
          </section>
        }
      >
        {/* UX-Q4: forward-transition CTA promoted to primary top placement
            when state === 'ready_to_ship'. Predicate lives in
            `@/lib/workflow/nextStepCTA` so the regression test can lock the
            trigger state. Deep-links to the create-shipment form with
            project_id pre-filled. */}
        {shouldShowProjectNextStepCTA(state) && (
          <NextStepCTA
            label="Create shipment"
            to={`/3pl-operations/shipments/new?project_id=${projectId}`}
          />
        )}

        {/* Secondary cluster of FSM transitions. */}
        <div className="flex flex-wrap gap-2">
          {PROJECT_TARGETS
            .filter((to) => to !== state && canTransition(PROJECT_FSM, state, to))
            .map((to) => (
              <Button
                key={to}
                variant="secondary"
                onClick={async () => {
                  // UX-Q8: only the cancelled transition is destructive.
                  if (to === 'cancelled' && !(await destructiveConfirm({
                    action: 'Cancel this project',
                    consequence: 'The project will move to cancelled and stop appearing in active work lists.',
                  }))) return;
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

        {/* Wave 12 / A4: read-only frozen snapshot of the Job Builder template
            this project was built from. Renders only when the project converted
            from a templated quote. Proves the freeze: later edits to the live
            template never rewrite this record. */}
        {templateSnapshot && (
          <section data-testid="template-snapshot">
            <h2 className="text-2xl font-display tracking-wider text-ink mb-3">
              TEMPLATE SNAPSHOT
            </h2>
            <p className="text-ink-dim text-sm mb-3">
              Frozen copy of {templateLabel} captured when this project was
              created. Later edits to the live template do not change this record.
            </p>
            {templateSnapshot.lines.length === 0 ? (
              <p className="text-ink-dim text-sm">The template had no lines.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {templateSnapshot.lines.map((l, idx) => (
                  <li
                    key={l.id ?? idx}
                    className="border border-line p-3 flex items-center justify-between gap-4"
                  >
                    <span className="flex flex-col">
                      <span className="text-ink">{l.name}</span>
                      <span className="text-ink-dim text-sm font-mono">{l.line_kind}</span>
                    </span>
                    <span className="text-ink-dim text-sm font-mono">
                      {snapshotLineSummary(l)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section>
          <h2 className="text-2xl font-display tracking-wider text-ink mb-3">MATERIALS</h2>
          {lineItems.isLoading ? (
            <p className="text-ink-dim text-sm">Loading materials.</p>
          ) : lineItems.error ? (
            <p className="text-ink-dim text-sm">No materials yet.</p>
          ) : (lineItems.data ?? []).length === 0 ? (
            <DetailSectionEmptyCoaching
              entity="material"
              explainer="Materials are the parts and goods this project consumes. Add them to build a bill of materials and roll cost up to the project budget."
              icon={Package}
            />
          ) : (
            <DataTable
              columns={materialColumns}
              rows={lineItems.data ?? []}
              getRowKey={(l) => l.id}
              empty="No materials yet."
            />
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
                <DollarInput
                  label="Unit price"
                  value={materialPrice}
                  onChange={setMaterialPrice}
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
          {phases.length === 0 ? (
            <DetailSectionEmptyCoaching
              entity="phase"
              explainer="Phases break a project into trackable milestones. Use the form below to add the first one."
              icon={Layers}
            />
          ) : (
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
          )}

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
            <DetailSectionEmptyCoaching
              entity="receiving order"
              explainer="Receiving orders track inbound stock for this project. Create one when materials are due to arrive at the warehouse."
              ctaLabel="New receiving order"
              ctaTo={`/3pl-operations/receiving/new?project_id=${projectId}`}
              icon={Inbox}
            />
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

        {/* F-Wave9-AUDIT-V3-WAVE-C4-01: MANUFACTURING RUNS section. Server
            filtered by project_id. Mirrors the receiving + shipments
            section layouts above and below. */}
        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-2xl font-display tracking-wider text-ink">MANUFACTURING RUNS</h2>
            <Link
              to={buildNewManufacturingRunUrl(projectId)}
              className="text-sm text-accent hover:text-accent-bright"
              data-testid="project-mfg-new-link"
            >
              New manufacturing run
            </Link>
          </div>
          {projectManufacturingRuns.length === 0 ? (
            <DetailSectionEmptyCoaching
              entity="manufacturing run"
              explainer="Manufacturing runs convert raw materials into finished goods. Schedule one when the line is ready to start production."
              ctaLabel="New manufacturing run"
              ctaTo={buildNewManufacturingRunUrl(projectId)}
              icon={Factory}
            />
          ) : (
            <ul className="flex flex-col gap-2" data-testid="project-mfg-list">
              {projectManufacturingRuns.map((r) => (
                <li key={r.id} className="border border-line p-3">
                  <Link
                    to={buildManufacturingRunDetailUrl(r.id)}
                    className="text-ink hover:text-accent font-mono text-sm"
                  >
                    {r.run_number ?? r.id}
                  </Link>
                  <span className="text-ink-dim text-sm ml-3">{r.status}</span>
                  {r.planned_start_at && (
                    <span className="text-ink-dim text-sm ml-3 font-mono">
                      planned {r.planned_start_at.slice(0, 10)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-2xl font-display tracking-wider text-ink">SHIPMENTS</h2>
            <Link
              to={buildNewShipmentUrl(projectId)}
              className="text-sm text-accent hover:text-accent-bright"
              data-testid="project-shipment-new-link"
            >
              New shipment
            </Link>
          </div>
          {projectShipments.length === 0 ? (
            <DetailSectionEmptyCoaching
              entity="shipment"
              explainer="Shipments move finished goods out to the customer. Create one when the project is packed and ready to leave the dock."
              ctaLabel="New shipment"
              ctaTo={buildNewShipmentUrl(projectId)}
              icon={Truck}
            />
          ) : (
            <ul className="flex flex-col gap-2" data-testid="project-shipment-list">
              {projectShipments.map((s) => (
                <li key={s.id} className="border border-line p-3">
                  <Link
                    to={buildShipmentDetailUrl(s.id)}
                    className="text-ink hover:text-accent font-mono text-sm"
                  >
                    {s.shipment_number ?? s.id}
                  </Link>
                  <span className="text-ink-dim text-sm ml-3">{s.status}</span>
                  {s.ship_date && (
                    <span className="text-ink-dim text-sm ml-3 font-mono">
                      {s.ship_date.slice(0, 10)}
                    </span>
                  )}
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
            <DetailSectionEmptyCoaching
              entity="invoice"
              explainer="Invoices bill the customer for delivered work. Convert the project to an invoice once it reaches completed status."
              icon={FileText}
            />
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
      </DetailLayout>
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
