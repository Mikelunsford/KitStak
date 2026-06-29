// Job jacket tab: the approval state machine that gates the run start, plus the
// internal floor task list generated from the build definition. Approve / reject
// / reopen run through the jacket transition hook; an unapproved jacket blocks
// start_job_run (the P2b-1 start-gate). Uses hooks, so it is not
// element-tree-walk tested; the floor task list is unit-tested in jobLogic.
// ADR 0006 P2c.

import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import {
  useEnsureJobRunJacket,
  useTransitionJobRunJacket,
} from '@/lib/hooks/useJobArtifacts';
import { buildTaskList } from '@/lib/jobbuilder/jobLogic';
import type { Job } from '@/lib/jobbuilder/jobModel';
import type { JobRunJacket } from '@/lib/types/jobbuilder';

const STATUS_LABEL: Record<JobRunJacket['status'], string> = {
  draft: 'Draft',
  approved: 'Approved',
  rejected: 'Rejected',
};

export function JacketTab({
  runId,
  jacket,
  job,
}: {
  runId: string;
  jacket: JobRunJacket | null;
  job: Job;
}) {
  const ensure = useEnsureJobRunJacket(runId);
  const transition = useTransitionJobRunJacket(runId);
  const [reason, setReason] = useState('');

  const tasks = buildTaskList(job);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="font-display text-lg tracking-wide text-ink">Job jacket</h3>
        <p className="font-sans text-sm text-ink-dim">
          Approve the jacket to release the run. An unapproved jacket blocks start.
        </p>
      </div>

      {!jacket ? (
        <div className="flex items-center justify-between gap-4 border border-line bg-bg-2 p-4">
          <span className="font-sans text-sm text-ink-dim">No jacket yet.</span>
          <Button variant="secondary" onClick={() => ensure.mutate()} disabled={ensure.isPending}>
            Create jacket
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 border border-line bg-bg-2 p-4">
          <div className="flex items-center justify-between gap-4">
            <span className="font-sans text-xs uppercase tracking-wide text-ink-dim">Status</span>
            <span className="border border-line px-2 py-0.5 font-sans text-xs uppercase tracking-wide text-ink">
              {STATUS_LABEL[jacket.status]}
            </span>
          </div>
          {jacket.status === 'rejected' && jacket.rejection_reason ? (
            <p className="font-sans text-sm text-accent">{jacket.rejection_reason}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {jacket.status !== 'approved' ? (
              <Button onClick={() => transition.mutate({ decision: 'approve' })} disabled={transition.isPending}>
                Approve
              </Button>
            ) : null}
            {jacket.status === 'draft' ? (
              <div className="flex items-center gap-2">
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Rejection reason"
                  className="bg-bg-2 border border-line text-ink px-2 py-1.5 font-sans text-sm focus:outline-none focus:border-accent"
                />
                <Button
                  variant="secondary"
                  onClick={() => transition.mutate({ decision: 'reject', reason })}
                  disabled={transition.isPending || !reason.trim()}
                >
                  Reject
                </Button>
              </div>
            ) : null}
            {jacket.status !== 'draft' ? (
              <Button variant="ghost" onClick={() => transition.mutate({ decision: 'reopen' })} disabled={transition.isPending}>
                Reopen
              </Button>
            ) : null}
          </div>
          {transition.error ? (
            <p className="font-sans text-sm text-accent">
              {transition.error instanceof Error ? transition.error.message : 'Transition failed.'}
            </p>
          ) : null}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h4 className="font-display text-base tracking-wide text-ink">Floor tasks</h4>
        <p className="font-sans text-sm text-ink-dim">
          Generated from the BOM, receiving, scope, and labels.
        </p>
        <div className="border border-line">
          {tasks.map((t) => (
            <div key={t.id} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-0">
              <span className="shrink-0 border border-line px-1.5 py-0.5 font-sans text-[10px] uppercase tracking-wide text-ink-dim">
                {t.area}
              </span>
              <span className="font-sans text-sm text-ink">{t.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
