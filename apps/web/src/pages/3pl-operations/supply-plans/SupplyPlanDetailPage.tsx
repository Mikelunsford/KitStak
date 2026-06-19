// SupplyPlanDetailPage (Wave 12 Phase A5). The supply-plan hub: demand lines
// (required / available / reserved / shortage per item) plus the release and
// cancel actions. Release reserves available stock (spine reserve movements) and
// records the shortage; cancel releases the holds. Supply plan is an FSM but is
// not registered in the SPA StateStepper paths (like Co-Pack / KitForce FSMs),
// so the status renders as a StatusBadge and the eyebrow is omitted (the FSM
// detail convention). Actions and the add-line form are gated to draft state and
// the matching capabilities; the server is authority.

import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Package } from 'lucide-react';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { DetailSectionEmptyCoaching } from '@/components/shell/DetailSectionEmptyCoaching';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { Select } from '@/components/ui/Select';
import { PageHeader } from '@/components/ui/PageHeader';
import { DetailLayout } from '@/components/ui/DetailLayout';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ItemPicker } from '@/components/ui/pickers';
import { destructiveConfirm } from '@/lib/destructiveConfirm';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { useItem } from '@/lib/hooks/useItems';
import {
  useSupplyPlan,
  useSupplyPlanLines,
  useReleaseSupplyPlan,
  useCancelSupplyPlan,
  useFulfillSupplyPlan,
  useCreateSupplyPlanLine,
  useDeleteSupplyPlanLine,
} from '@/lib/hooks/useSupplyPlans';
import type {
  SupplyPlanLine,
  SupplyPlanResolution,
} from '@/lib/services/supplyPlansService';

const RESOLUTIONS: ReadonlyArray<SupplyPlanResolution> = [
  'reserve',
  'inbound',
  'purchase',
  'replenish',
];

// Resolve an item_id to its name for the demand table. Small N (lines per plan)
// so a per-row read is acceptable; falls back to the short id while loading.
function ItemName({ itemId }: { itemId: string }) {
  const { data } = useItem(itemId);
  return <>{data?.name ?? itemId.slice(0, 8)}</>;
}

export function SupplyPlanDetailPage() {
  const { id } = useParams();
  const planId = id ?? '';
  const { data: plan, isLoading, error } = useSupplyPlan(id);
  const lines = useSupplyPlanLines(planId);
  const release = useReleaseSupplyPlan(planId);
  const cancel = useCancelSupplyPlan(planId);
  const fulfill = useFulfillSupplyPlan(planId);
  const addLine = useCreateSupplyPlanLine(planId);
  const removeLine = useDeleteSupplyPlanLine(planId);
  const caps = useCapabilities();

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [requiredQty, setRequiredQty] = useState('1');
  const [resolution, setResolution] = useState<SupplyPlanResolution>('reserve');

  if (isLoading) return <p className="p-8 text-ink-dim">Loading.</p>;
  if (error || !plan) return <p className="p-8 text-accent">Supply plan not found.</p>;

  const isDraft = plan.status === 'draft';
  const isReleased = plan.status === 'released';
  const actionError = release.error ?? cancel.error ?? fulfill.error;

  const onAddLine = (e: FormEvent) => {
    e.preventDefault();
    if (!selectedItemId) return;
    addLine.mutate(
      { item_id: selectedItemId, required_qty: requiredQty, resolution },
      {
        onSuccess: () => {
          setSelectedItemId(null);
          setRequiredQty('1');
          setResolution('reserve');
        },
      },
    );
  };

  const actionColumn: DataColumn<SupplyPlanLine>[] =
    isDraft && caps.can('threepl.supply_plan.line.delete')
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

  const columns: ReadonlyArray<DataColumn<SupplyPlanLine>> = [
    { key: 'item', header: 'Item', render: (l) => <ItemName itemId={l.item_id} /> },
    {
      key: 'required',
      header: 'Required',
      align: 'right',
      cellClassName: 'tabular-nums',
      render: (l) => Number(l.required_qty).toFixed(2),
    },
    {
      key: 'available',
      header: 'Available',
      align: 'right',
      cellClassName: 'tabular-nums text-ink-dim',
      render: (l) => Number(l.available_qty).toFixed(2),
    },
    {
      key: 'reserved',
      header: 'Reserved',
      align: 'right',
      cellClassName: 'tabular-nums',
      render: (l) => Number(l.reserved_qty).toFixed(2),
    },
    {
      key: 'shortage',
      header: 'Shortage',
      align: 'right',
      cellClassName: 'tabular-nums',
      render: (l) => {
        const s = Number(l.shortage_qty);
        return <span className={s > 0 ? 'text-accent' : ''}>{s.toFixed(2)}</span>;
      },
    },
    {
      key: 'resolution',
      header: 'Resolution',
      cellClassName: 'capitalize text-ink-dim',
      render: (l) => l.resolution,
    },
    ...actionColumn,
  ];

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-8 px-8 py-12">
      <PageHeader
        title={plan.plan_number ?? plan.id.slice(0, 8)}
        meta={
          <span className="flex flex-col gap-2">
            <span>
              <StatusBadge status={plan.status} />
            </span>
            {plan.project_id && (
              <span className="text-sm">
                Project:{' '}
                <Link
                  to={`/projects/${plan.project_id}`}
                  className="text-ink hover:text-accent font-mono"
                  data-testid="supply-plan-project-link"
                >
                  {plan.project_id.slice(0, 8)}
                </Link>
              </span>
            )}
          </span>
        }
      />

      <DetailLayout
        rail={
          <section>
            <h2 className="mb-3 text-2xl font-display tracking-wide text-ink">
              HISTORY
            </h2>
            <AuditTimeline entityType="supply_plan" entityId={id ?? null} />
          </section>
        }
      >
        <div className="flex flex-wrap gap-2">
          {isDraft && caps.can('threepl.supply_plan.release') && (
            <Button onClick={() => release.mutate()} disabled={release.isPending}>
              {release.isPending ? 'Releasing.' : 'Release and reserve'}
            </Button>
          )}
          {isReleased && caps.can('threepl.supply_plan.fulfill') && (
            <Button onClick={() => fulfill.mutate()} disabled={fulfill.isPending}>
              {fulfill.isPending ? 'Fulfilling.' : 'Mark fulfilled'}
            </Button>
          )}
          {(isDraft || isReleased) && caps.can('threepl.supply_plan.cancel') && (
            <Button
              variant="secondary"
              disabled={cancel.isPending}
              onClick={async () => {
                if (
                  !(await destructiveConfirm({
                    action: 'Cancel this supply plan',
                    consequence: isReleased
                      ? 'Reservations will be released back to available stock.'
                      : 'The plan will move to cancelled.',
                  }))
                )
                  return;
                cancel.mutate();
              }}
            >
              {cancel.isPending ? 'Cancelling.' : 'Cancel plan'}
            </Button>
          )}
        </div>
        {actionError && (
          <p className="font-sans text-sm text-accent">
            {actionError instanceof Error ? actionError.message : 'Action failed.'}
          </p>
        )}

        <section>
          <h2 className="text-2xl font-display tracking-wider text-ink mb-3">
            DEMAND LINES
          </h2>
          {lines.isLoading ? (
            <p className="text-ink-dim text-sm">Loading demand lines.</p>
          ) : (lines.data ?? []).length === 0 ? (
            <DetailSectionEmptyCoaching
              entity="demand line"
              explainer="Demand lines are the materials this plan needs. Add them, then release to reserve available stock and surface any shortage."
              icon={Package}
            />
          ) : (
            <DataTable
              columns={columns}
              rows={lines.data ?? []}
              getRowKey={(l) => l.id}
              empty="No demand lines yet."
            />
          )}

          {isDraft && caps.can('threepl.supply_plan.line.create') && (
            <form
              onSubmit={onAddLine}
              className="flex flex-col gap-3 border border-line p-4 mt-4"
            >
              <h3 className="font-display tracking-wider text-ink">ADD DEMAND LINE</h3>
              <ItemPicker
                value={selectedItemId}
                onChange={setSelectedItemId}
                label="Item"
                filter={{ active: true }}
              />
              <div className="flex gap-3 flex-wrap items-end">
                <TextInput
                  label="Required qty"
                  value={requiredQty}
                  onChange={(e) => setRequiredQty(e.target.value)}
                  inputMode="decimal"
                />
                <Select
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value as SupplyPlanResolution)}
                  aria-label="Shortage resolution"
                >
                  {RESOLUTIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Select>
                <Button type="submit" disabled={addLine.isPending || !selectedItemId}>
                  {addLine.isPending ? 'Adding.' : 'Add line'}
                </Button>
              </div>
              {addLine.isError && (
                <p className="font-sans text-sm text-accent">
                  {addLine.error instanceof Error ? addLine.error.message : 'Add line failed.'}
                </p>
              )}
            </form>
          )}
        </section>
      </DetailLayout>
    </section>
  );
}
