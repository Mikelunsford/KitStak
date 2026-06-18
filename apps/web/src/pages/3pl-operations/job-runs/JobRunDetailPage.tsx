// JobRunDetailPage (Wave 12 Phase A6). The job-run hub: the FSM transition
// cluster (start / complete / close / cancel) plus the DAILY LOGS section. Each
// daily log expands to its consumed and produced lines; posting a draft log
// emits the spine stock movements (consumed out, produced in) and freezes the
// log. Job run is an FSM but is not registered in the SPA StateStepper paths
// (like the Supply Plan / Co-Pack / KitForce FSMs), so the status renders as a
// StatusBadge and the eyebrow is omitted (the FSM detail convention). Actions
// and the edit forms are gated by state and the matching capabilities; the
// server is authority.

import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';

import { CalendarCheck } from 'lucide-react';

import { AuditTimeline } from '@/components/shell/AuditTimeline';
import { DetailSectionEmptyCoaching } from '@/components/shell/DetailSectionEmptyCoaching';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { PageHeader } from '@/components/ui/PageHeader';
import { DetailLayout } from '@/components/ui/DetailLayout';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ItemPicker } from '@/components/ui/pickers';
import { SupplySourceSelect } from '@/components/forms/SupplySourceSelect';
import { destructiveConfirm } from '@/lib/destructiveConfirm';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { useItem } from '@/lib/hooks/useItems';
import {
  useJobRun,
  useJobRunDailyLogs,
  useStartJobRun,
  useCompleteJobRun,
  useCloseJobRun,
  useCancelJobRun,
  useCreateJobRunDailyLog,
  useDeleteJobRunDailyLog,
  usePostJobRunDailyLog,
  useJobRunDailyLogConsumedLines,
  useJobRunDailyLogProducedLines,
  useCreateJobRunDailyLogConsumedLine,
  useDeleteJobRunDailyLogConsumedLine,
  useCreateJobRunDailyLogProducedLine,
  useDeleteJobRunDailyLogProducedLine,
} from '@/lib/hooks/useJobRuns';
import type {
  JobRunDailyLog,
  JobRunDailyLogConsumedLine,
  JobRunDailyLogProducedLine,
} from '@/lib/services/jobRunsService';
import type { ItemSupplySource } from '@/lib/types/sales';

// Resolve an item_id to its name. Small N (lines per log) so a per-row read is
// acceptable; falls back to the short id while loading.
function ItemName({ itemId }: { itemId: string | null }) {
  const { data } = useItem(itemId ?? undefined);
  if (!itemId) return <span className="text-ink-dim">(no item)</span>;
  return <>{data?.name ?? itemId.slice(0, 8)}</>;
}

// The consumed / produced line editor for one daily log. Mounted only when the
// card is expanded so the line queries are lazy. Add and remove are gated to a
// draft log plus the daily_log.update capability.
function DailyLogLines({
  runId,
  log,
  canEdit,
}: {
  runId: string;
  log: JobRunDailyLog;
  canEdit: boolean;
}) {
  const consumed = useJobRunDailyLogConsumedLines(runId, log.id);
  const produced = useJobRunDailyLogProducedLines(runId, log.id);
  const addConsumed = useCreateJobRunDailyLogConsumedLine(runId, log.id);
  const removeConsumed = useDeleteJobRunDailyLogConsumedLine(runId, log.id);
  const addProduced = useCreateJobRunDailyLogProducedLine(runId, log.id);
  const removeProduced = useDeleteJobRunDailyLogProducedLine(runId, log.id);

  const [consumedItem, setConsumedItem] = useState<string | null>(null);
  const [consumedQty, setConsumedQty] = useState('1');
  const [consumedSupplySource, setConsumedSupplySource] =
    useState<ItemSupplySource | null>(null);
  const [producedItem, setProducedItem] = useState<string | null>(null);
  const [producedQty, setProducedQty] = useState('1');

  const consumedCols: DataColumn<JobRunDailyLogConsumedLine>[] = [
    { key: 'item', header: 'Item', render: (l) => <ItemName itemId={l.item_id} /> },
    {
      key: 'qty',
      header: 'Qty',
      align: 'right',
      cellClassName: 'font-mono',
      render: (l) => Number(l.quantity).toFixed(2),
    },
    ...(canEdit
      ? [
          {
            key: 'actions',
            header: '',
            align: 'right' as const,
            render: (l: JobRunDailyLogConsumedLine) => (
              <Button variant="ghost" onClick={() => removeConsumed.mutate(l.id)}>
                Remove
              </Button>
            ),
          },
        ]
      : []),
  ];

  const producedCols: DataColumn<JobRunDailyLogProducedLine>[] = [
    { key: 'item', header: 'Item', render: (l) => <ItemName itemId={l.item_id} /> },
    {
      key: 'qty',
      header: 'Qty',
      align: 'right',
      cellClassName: 'font-mono',
      render: (l) => Number(l.quantity).toFixed(2),
    },
    ...(canEdit
      ? [
          {
            key: 'actions',
            header: '',
            align: 'right' as const,
            render: (l: JobRunDailyLogProducedLine) => (
              <Button variant="ghost" onClick={() => removeProduced.mutate(l.id)}>
                Remove
              </Button>
            ),
          },
        ]
      : []),
  ];

  const onAddConsumed = (e: FormEvent) => {
    e.preventDefault();
    if (!consumedItem) return;
    addConsumed.mutate(
      {
        item_id: consumedItem,
        quantity: consumedQty,
        supply_source: consumedSupplySource,
      },
      {
        onSuccess: () => {
          setConsumedItem(null);
          setConsumedQty('1');
          setConsumedSupplySource(null);
        },
      },
    );
  };

  const onAddProduced = (e: FormEvent) => {
    e.preventDefault();
    addProduced.mutate(
      { item_id: producedItem, quantity: producedQty },
      {
        onSuccess: () => {
          setProducedItem(null);
          setProducedQty('1');
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-6 border-t border-line pt-4">
      <div>
        <h4 className="mb-2 font-display tracking-wider text-ink">CONSUMED</h4>
        <DataTable
          columns={consumedCols}
          rows={consumed.data ?? []}
          getRowKey={(l) => l.id}
          loading={consumed.isLoading}
          empty="No consumed lines."
        />
        {canEdit && (
          <form onSubmit={onAddConsumed} className="mt-3 flex flex-wrap items-end gap-3">
            <ItemPicker
              value={consumedItem}
              onChange={setConsumedItem}
              label="Item (required)"
              filter={{ active: true }}
            />
            <TextInput
              label="Qty"
              value={consumedQty}
              onChange={(e) => setConsumedQty(e.target.value)}
              inputMode="decimal"
            />
            <SupplySourceSelect
              value={consumedSupplySource}
              onChange={setConsumedSupplySource}
            />
            <Button type="submit" disabled={addConsumed.isPending || !consumedItem}>
              {addConsumed.isPending ? 'Adding.' : 'Add consumed'}
            </Button>
          </form>
        )}
      </div>

      <div>
        <h4 className="mb-2 font-display tracking-wider text-ink">PRODUCED</h4>
        <DataTable
          columns={producedCols}
          rows={produced.data ?? []}
          getRowKey={(l) => l.id}
          loading={produced.isLoading}
          empty="No produced lines."
        />
        {canEdit && (
          <form onSubmit={onAddProduced} className="mt-3 flex flex-wrap items-end gap-3">
            <ItemPicker
              value={producedItem}
              onChange={setProducedItem}
              label="Item (optional)"
              filter={{ active: true }}
            />
            <TextInput
              label="Qty"
              value={producedQty}
              onChange={(e) => setProducedQty(e.target.value)}
              inputMode="decimal"
            />
            <Button type="submit" disabled={addProduced.isPending}>
              {addProduced.isPending ? 'Adding.' : 'Add produced'}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

// One daily log card: header (date, status, labor) plus an expand toggle, the
// Post action (draft + cap), and the line editor.
function DailyLogCard({ runId, log }: { runId: string; log: JobRunDailyLog }) {
  const caps = useCapabilities();
  const post = usePostJobRunDailyLog(runId);
  const removeLog = useDeleteJobRunDailyLog(runId);
  const [open, setOpen] = useState(false);

  const isDraft = log.status === 'draft';
  const canEditLines = isDraft && caps.can('threepl.job_run.daily_log.update');

  return (
    <div className="border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="font-mono text-ink hover:text-accent"
            aria-expanded={open}
          >
            {open ? '▾' : '▸'} {log.log_date.slice(0, 10)}
          </button>
          <StatusBadge status={log.status} />
          <span className="font-mono text-sm text-ink-dim">
            {Number(log.labor_hours).toFixed(2)} h
          </span>
        </div>
        <div className="flex gap-2">
          {isDraft && caps.can('threepl.job_run.daily_log.post') && (
            <Button onClick={() => post.mutate(log.id)} disabled={post.isPending}>
              {post.isPending ? 'Posting.' : 'Post'}
            </Button>
          )}
          {isDraft && caps.can('threepl.job_run.daily_log.update') && (
            <Button
              variant="ghost"
              disabled={removeLog.isPending}
              onClick={async () => {
                if (
                  !(await destructiveConfirm({
                    action: 'Delete this daily log',
                    consequence: 'The draft log and its lines will be removed.',
                  }))
                )
                  return;
                removeLog.mutate(log.id);
              }}
            >
              Delete
            </Button>
          )}
        </div>
      </div>
      {post.isError && (
        <p className="mt-2 font-sans text-sm text-accent">
          {post.error instanceof Error ? post.error.message : 'Post failed.'}
        </p>
      )}
      {open && (
        <div className="mt-4">
          <DailyLogLines runId={runId} log={log} canEdit={canEditLines} />
        </div>
      )}
    </div>
  );
}

export function JobRunDetailPage() {
  const { id } = useParams();
  const runId = id ?? '';
  const { data: run, isLoading, error } = useJobRun(id);
  const logs = useJobRunDailyLogs(runId);
  const start = useStartJobRun(runId);
  const complete = useCompleteJobRun(runId);
  const close = useCloseJobRun(runId);
  const cancel = useCancelJobRun(runId);
  const addLog = useCreateJobRunDailyLog(runId);
  const caps = useCapabilities();

  const [logDate, setLogDate] = useState('');
  const [laborHours, setLaborHours] = useState('');
  const [logNotes, setLogNotes] = useState('');

  if (isLoading) return <p className="p-8 text-ink-dim">Loading.</p>;
  if (error || !run) return <p className="p-8 text-accent">Job run not found.</p>;

  const isPlanned = run.status === 'planned';
  const isInProgress = run.status === 'in_progress';
  const isCompleted = run.status === 'completed';
  const canLogWork = run.status !== 'closed' && run.status !== 'cancelled';
  const transitionError = start.error ?? complete.error ?? close.error ?? cancel.error;

  const onAddLog = (e: FormEvent) => {
    e.preventDefault();
    addLog.mutate(
      {
        ...(logDate ? { log_date: logDate } : {}),
        labor_hours: laborHours.trim() ? laborHours.trim() : 0,
        notes: logNotes.trim() ? logNotes.trim() : null,
      },
      {
        onSuccess: () => {
          setLogDate('');
          setLaborHours('');
          setLogNotes('');
        },
      },
    );
  };

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-8 px-8 py-12">
      <PageHeader
        title={run.run_number ?? run.id.slice(0, 8)}
        meta={
          <span className="flex flex-col gap-2">
            <span>
              <StatusBadge status={run.status} />
            </span>
            {run.project_id && (
              <span className="text-sm">
                Project:{' '}
                <Link
                  to={`/projects/${run.project_id}`}
                  className="text-ink hover:text-accent font-mono"
                  data-testid="job-run-project-link"
                >
                  {run.project_id.slice(0, 8)}
                </Link>
              </span>
            )}
            {run.account_id && (
              <span className="text-sm">
                Account:{' '}
                <Link
                  to={`/3pl-operations/accounts/${run.account_id}`}
                  className="text-ink hover:text-accent font-mono"
                  data-testid="job-run-account-link"
                >
                  {run.account_id.slice(0, 8)}
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
            <AuditTimeline entityType="job_run" entityId={id ?? null} />
          </section>
        }
      >
        <div className="flex flex-wrap gap-2">
          {isPlanned && caps.can('threepl.job_run.start') && (
            <Button onClick={() => start.mutate()} disabled={start.isPending}>
              {start.isPending ? 'Starting.' : 'Start run'}
            </Button>
          )}
          {isInProgress && caps.can('threepl.job_run.complete') && (
            <Button onClick={() => complete.mutate()} disabled={complete.isPending}>
              {complete.isPending ? 'Completing.' : 'Complete run'}
            </Button>
          )}
          {isCompleted && caps.can('threepl.job_run.close') && (
            <Button onClick={() => close.mutate()} disabled={close.isPending}>
              {close.isPending ? 'Closing.' : 'Close run'}
            </Button>
          )}
          {(isPlanned || isInProgress) && caps.can('threepl.job_run.cancel') && (
            <Button
              variant="secondary"
              disabled={cancel.isPending}
              onClick={async () => {
                if (
                  !(await destructiveConfirm({
                    action: 'Cancel this job run',
                    consequence:
                      'The run moves to cancelled. Already-posted daily logs are not reversed.',
                  }))
                )
                  return;
                cancel.mutate();
              }}
            >
              {cancel.isPending ? 'Cancelling.' : 'Cancel run'}
            </Button>
          )}
        </div>
        {transitionError && (
          <p className="font-sans text-sm text-accent">
            {transitionError instanceof Error ? transitionError.message : 'Action failed.'}
          </p>
        )}

        <section>
          <h2 className="mb-3 text-2xl font-display tracking-wider text-ink">
            DAILY LOGS
          </h2>
          {logs.isLoading ? (
            <p className="text-ink-dim text-sm">Loading daily logs.</p>
          ) : (logs.data ?? []).length === 0 ? (
            <DetailSectionEmptyCoaching
              entity="daily log"
              explainer="A daily log records one day's work on this run: the materials consumed and outputs produced. Posting a log moves that stock and freezes the day."
              icon={CalendarCheck}
            />
          ) : (
            <div className="flex flex-col gap-3">
              {(logs.data ?? []).map((log) => (
                <DailyLogCard key={log.id} runId={runId} log={log} />
              ))}
            </div>
          )}

          {canLogWork && caps.can('threepl.job_run.daily_log.create') && (
            <form
              onSubmit={onAddLog}
              className="mt-4 flex flex-col gap-3 border border-line p-4"
            >
              <h3 className="font-display tracking-wider text-ink">ADD DAILY LOG</h3>
              <div className="flex flex-wrap items-end gap-3">
                <TextInput
                  label="Date (today if blank)"
                  type="date"
                  value={logDate}
                  onChange={(e) => setLogDate(e.target.value)}
                />
                <TextInput
                  label="Labor hours"
                  value={laborHours}
                  onChange={(e) => setLaborHours(e.target.value)}
                  inputMode="decimal"
                />
                <Button type="submit" disabled={addLog.isPending}>
                  {addLog.isPending ? 'Adding.' : 'Add daily log'}
                </Button>
              </div>
              <TextInput
                label="Notes"
                value={logNotes}
                onChange={(e) => setLogNotes(e.target.value)}
              />
              {addLog.isError && (
                <p className="font-sans text-sm text-accent">
                  {addLog.error instanceof Error ? addLog.error.message : 'Add daily log failed.'}
                </p>
              )}
            </form>
          )}
        </section>
      </DetailLayout>
    </section>
  );
}
