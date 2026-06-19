// WmsPutawayDetailPage (Wave 12 Body B Phase B3). The putaway-task hub: the FSM
// transition cluster (start / complete / cancel) plus the key fields and a
// HISTORY rail. A putaway task is an FSM but is not registered in the SPA
// StateStepper paths (like the Job Run / Supply Plan FSMs), so the status renders
// as a StatusBadge and the eyebrow is OMITTED (the FSM detail convention).
// Completing a task emits a warehouse-flat internal move (transfer_out at the
// dock + transfer_in at the destination bin); actions are gated by state and the
// matching capabilities. The server is authority.

import { useState } from 'react';
import { useParams } from 'react-router-dom';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import { EntityLabel } from '@/components/data/EntityLabel';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { DetailLayout } from '@/components/ui/DetailLayout';
import { Select } from '@/components/ui/Select';
import { StatusBadge } from '@/components/ui/StatusBadge';
import {
  useWmsPutawayTask,
  useSetWmsPutawayDestination,
  useStartWmsPutaway,
  useCompleteWmsPutaway,
  useCancelWmsPutaway,
} from '@/lib/hooks/useWmsPutaway';
import { useWmsLocation, useWmsLocationsList } from '@/lib/hooks/useWmsLocations';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { destructiveConfirm } from '@/lib/destructiveConfirm';

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(d);
}

// Resolve a location_id to its code. Falls back to the short id while loading,
// and renders a dash when the location is unset (e.g. no-bin source).
function LocationCode({ id }: { id: string | null }) {
  const { data } = useWmsLocation(id ?? undefined);
  if (!id) return <span className="text-ink-dim">(none)</span>;
  return <span className="font-mono">{data?.code ?? id.slice(0, 8)}</span>;
}

export function WmsPutawayDetailPage() {
  const { id } = useParams<{ id: string }>();
  const taskId = id ?? '';
  const { data: task, isLoading, error } = useWmsPutawayTask(id);
  const start = useStartWmsPutaway(taskId);
  const setDestination = useSetWmsPutawayDestination(taskId);
  const complete = useCompleteWmsPutaway(taskId);
  const cancel = useCancelWmsPutaway(taskId);
  const caps = useCapabilities();
  const [selectedBin, setSelectedBin] = useState('');

  // Destination bins are the live (active, non-deleted) locations in the task's
  // warehouse. Only fetched once the task has loaded (warehouse known); the
  // server re-validates the bin lives in the warehouse on the set call.
  const bins = useWmsLocationsList(
    task ? { warehouse_id: task.warehouse_id, active: true } : {},
    !!task,
  );

  if (isLoading) return <p className="px-8 py-12 text-ink-dim">Loading.</p>;
  if (error || !task) {
    return <p className="px-8 py-12 text-accent">Putaway task not found.</p>;
  }

  const isSuggested = task.status === 'suggested';
  const isInProgress = task.status === 'in_progress';
  const isDone = task.status === 'done';
  const isCancelled = task.status === 'cancelled';
  const transitionError =
    start.error ?? setDestination.error ?? complete.error ?? cancel.error;
  // A complete now REQUIRES a destination bin (the server raises STATE_CONFLICT
  // otherwise). Surface a set-destination control while the task is still open
  // and no destination is set, so the operator can pick the bin before completing.
  const isOpen = isSuggested || isInProgress;
  const needsDestination = isOpen && task.actual_location_id == null;

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-6 px-8 py-12">
      <Breadcrumbs
        items={[
          { label: 'Putaway', to: '/wms/putaway' },
          { label: task.id.slice(0, 8) },
        ]}
      />
      <PageHeader
        title={task.id.slice(0, 8)}
        meta={
          <span className="flex flex-col gap-2">
            <span>
              <StatusBadge status={task.status} />
            </span>
            <span className="text-sm">
              Item: <EntityLabel kind="item" id={task.item_id} />
            </span>
            <span className="text-sm tabular-nums">
              Qty {Number(task.quantity).toFixed(2)}
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
            <AuditTimeline entityType="putaway_task" entityId={id ?? null} />
          </section>
        }
      >
        {needsDestination && caps.can('wms.putaway.create') && (
          <div className="flex flex-col gap-2 border border-line bg-bg-2 p-4">
            <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
              Set destination bin
            </span>
            <p className="font-sans text-sm text-ink-dim">
              A putaway cannot complete without a destination bin. Pick one to stow the stock.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={selectedBin}
                onChange={(e) => setSelectedBin(e.target.value)}
                aria-label="Destination bin"
              >
                <option value="">Select a bin</option>
                {(bins.data ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code}
                  </option>
                ))}
              </Select>
              <Button
                disabled={!selectedBin || setDestination.isPending}
                onClick={() => setDestination.mutate(selectedBin)}
              >
                {setDestination.isPending ? 'Setting.' : 'Set destination'}
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {isSuggested && caps.can('wms.putaway.start') && (
            <Button onClick={() => start.mutate()} disabled={start.isPending}>
              {start.isPending ? 'Starting.' : 'Start putaway'}
            </Button>
          )}
          {isInProgress && caps.can('wms.putaway.complete') && (
            <Button onClick={() => complete.mutate()} disabled={complete.isPending}>
              {complete.isPending ? 'Completing.' : 'Complete putaway'}
            </Button>
          )}
          {!isDone && !isCancelled && caps.can('wms.putaway.cancel') && (
            <Button
              variant="secondary"
              disabled={cancel.isPending}
              onClick={async () => {
                if (
                  !(await destructiveConfirm({
                    action: 'Cancel this putaway task',
                    consequence:
                      'The task moves to cancelled. No stock is moved. A completed task cannot be cancelled.',
                  }))
                )
                  return;
                cancel.mutate();
              }}
            >
              {cancel.isPending ? 'Cancelling.' : 'Cancel putaway'}
            </Button>
          )}
        </div>
        {transitionError && (
          <p className="font-sans text-sm text-accent">
            {transitionError instanceof Error ? transitionError.message : 'Action failed.'}
          </p>
        )}

        <dl className="grid grid-cols-2 gap-4 font-sans text-sm">
          <dt className="text-ink-dim">Item</dt>
          <dd className="text-ink">
            <EntityLabel kind="item" id={task.item_id} />
          </dd>
          <dt className="text-ink-dim">Quantity</dt>
          <dd className="text-ink tabular-nums">{Number(task.quantity).toFixed(2)}</dd>
          <dt className="text-ink-dim">Warehouse</dt>
          <dd className="text-ink">
            <EntityLabel kind="warehouse" id={task.warehouse_id} />
          </dd>
          <dt className="text-ink-dim">Source (dock)</dt>
          <dd className="text-ink">
            <LocationCode id={task.source_location_id} />
          </dd>
          <dt className="text-ink-dim">Suggested bin</dt>
          <dd className="text-ink">
            <LocationCode id={task.suggested_location_id} />
          </dd>
          <dt className="text-ink-dim">Destination bin</dt>
          <dd className="text-ink">
            <LocationCode id={task.actual_location_id} />
          </dd>
          <dt className="text-ink-dim">Status</dt>
          <dd className="text-ink">
            <StatusBadge status={task.status} />
          </dd>
          <dt className="text-ink-dim">Created</dt>
          <dd className="text-ink">{formatDate(task.created_at)}</dd>
          <dt className="text-ink-dim">Notes</dt>
          <dd className="text-ink">{task.notes ?? ''}</dd>
        </dl>
      </DetailLayout>
    </section>
  );
}
