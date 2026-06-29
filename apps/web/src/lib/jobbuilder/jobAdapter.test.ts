// Unit tests for the backend -> Job adapter (ADR 0006 P2c). Proves the adapter
// fills the slice of Job that the ported jobLogic reads, so the readiness rail,
// schedule check, and floor task list run unchanged on live backend rows.

import { describe, it, expect } from 'vitest';

import { adaptJob, type JobBuilderData } from './jobAdapter';
import { readinessChecks, scheduleCheck, buildTaskList, totalInboundUnits } from './jobLogic';
import type { JobRun } from '@/lib/types/threepl';
import type { JobRunTimeline, JobRunJacket } from '@/lib/types/jobbuilder';

const RUN: JobRun = {
  id: 'run-uuid-1',
  org_id: 'org-1',
  run_number: 'JR-0007',
  project_id: 'proj-1',
  account_id: null,
  job_template_id: null,
  job_template_snapshot: null,
  warehouse_id: null,
  status: 'planned',
  started_at: null,
  completed_at: null,
  closed_at: null,
  cancelled_at: null,
  notes: null,
  payload: {},
  deleted_at: null,
  created_at: '2026-06-29T00:00:00Z',
  updated_at: '2026-06-29T00:00:00Z',
} as unknown as JobRun;

const TIMELINE: JobRunTimeline = {
  id: 'tl-1', org_id: 'org-1', job_run_id: 'run-uuid-1',
  mabd: '2026-09-01', materials_eta: '2026-08-10', build_start: '2026-08-15',
  build_end: '2026-08-20', ship_date: '2026-08-28',
  materials_received_on: null, build_started_on: null, build_ended_on: null,
  shipped_on: null, notes: null,
};

function fullData(over: Partial<JobBuilderData> = {}): JobBuilderData {
  return {
    run: RUN,
    projectName: 'Acme retail kitting',
    customerName: 'Acme',
    family: 'Co-pack',
    outputUnits: 1000,
    materials: [
      { itemId: 'i1', desc: 'Box', perUnit: 1 },
      { itemId: 'i2', desc: 'Insert', perUnit: 2 },
    ],
    receivingOrder: { number: 'RO-0003', eta: '2026-08-10' },
    labels: [
      { id: 'l1', org_id: 'org-1', job_run_id: 'run-uuid-1', label_kind: 'UPC', size: '4x6', data: { code: '810001192034' }, qty: 1000, position: 0 },
    ],
    sowSteps: [
      { id: 's1', org_id: 'org-1', job_run_id: 'run-uuid-1', step_no: 1, title: 'Kit', detail: 'Assemble', duration_hours: null, position: 0 },
    ],
    timeline: TIMELINE,
    jacket: { id: 'jk', org_id: 'org-1', job_run_id: 'run-uuid-1', status: 'approved', approved_by: 'u1', approved_at: '2026-06-29T00:00:00Z', rejected_by: null, rejected_at: null, rejection_reason: null, snapshot: null, notes: null } as JobRunJacket,
    ...over,
  };
}

describe('adaptJob', () => {
  it('maps a fully-populated build into the Job shape', () => {
    const job = adaptJob(fullData());
    expect(job.id).toBe('JR-0007');
    expect(job.project).toBe('Acme retail kitting');
    expect(job.qty).toBe(1000);
    expect(job.mabd).toBe('2026-09-01');
    expect(job.released).toBe(false); // status 'planned'
    expect(job.items).toHaveLength(2);
    expect(job.items[0]).toMatchObject({ itemNo: 'i1', desc: 'Box', perUnit: '1' });
    expect(job.ro).toMatchObject({ number: 'RO-0003', eta: '2026-08-10' });
    expect(job.labels[0]).toMatchObject({ kind: 'UPC', size: '4x6', qty: '1000' });
    expect(job.sow[0]).toMatchObject({ process: 'Kit', detail: 'Assemble' });
    expect(job.timeline).toMatchObject({
      materialsEta: '2026-08-10', buildStart: '2026-08-15', buildEnd: '2026-08-20', ship: '2026-08-28',
    });
    expect(job.jacket?.approved).toBe(true);
  });

  it('drives jobLogic: readiness 5/5 and an on-track schedule on a complete build', () => {
    const job = adaptJob(fullData());
    expect(readinessChecks(job).readyCount).toBe(5);
    const sched = scheduleCheck(job.timeline, job.mabd, job.ro.eta);
    expect(sched.statusBig).toBe('On track');
    expect(sched.allGreen).toBe(true);
    // inbound rollup = (1 + 2) * 1000 output units
    expect(totalInboundUnits(job)).toBe(3000);
    // floor task list covers receiving, staging, the SOW step, the label, QC, ship
    const tasks = buildTaskList(job);
    expect(tasks.some((t) => t.area === 'Receiving')).toBe(true);
    expect(tasks.some((t) => t.area === 'Shipping')).toBe(true);
  });

  it('reports an empty build as not ready, with unset dates and no jacket approval', () => {
    const job = adaptJob(fullData({
      materials: [], labels: [], sowSteps: [], receivingOrder: null, timeline: null, jacket: null,
    }));
    expect(readinessChecks(job).readyCount).toBe(0);
    expect(job.mabd).toBe('');
    expect(job.timeline.ship).toBe('');
    expect(job.jacket?.approved).toBe(false);
    expect(scheduleCheck(job.timeline, job.mabd, job.ro.eta).statusBig).toBe('Set ship date');
  });

  it('falls back to the run id when run_number is null and flags a started run released', () => {
    const job = adaptJob(fullData({
      run: { ...RUN, run_number: null, status: 'in_progress' } as JobRun,
    }));
    expect(job.id).toBe('run-uuid-1');
    expect(job.released).toBe(true);
  });
});
