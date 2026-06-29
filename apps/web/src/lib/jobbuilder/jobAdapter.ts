// Bridge the real backend rows (a job_run + its run-scoped build artifacts +
// the linked receiving order + the project materials) into the prototype's
// `Job` shape so the ported, unit-tested jobLogic (readiness, schedule check,
// floor task list, milestones) runs unchanged on live data. ADR 0006 P2c.
//
// jobLogic only reads a narrow slice of Job: qty, items (length + perUnit), ro
// (number + eta), labels (kind / size / qty), sow (process / detail), timeline
// (the four planned dates) + mabd, and jacket.approved. This adapter fills that
// slice from the canon rows; descriptive-only fields the logic never touches
// (sku, weight, dims, supplier) carry through where available, else empty.

import type { JobRun } from '@/lib/types/threepl';
import type {
  JobRunLabel,
  JobRunSowStep,
  JobRunTimeline,
  JobRunJacket,
} from '@/lib/types/jobbuilder';
import type { Job, BomItem } from './jobModel';

// One project material that resolves to a catalog item: the per-output-unit
// quantity drives the inbound rollup, the descriptive fields drive the BOM tab.
export interface JobMaterial {
  itemId: string;
  sku?: string;
  itemNo?: string;
  desc?: string;
  weight?: string;
  dims?: string;
  perUnit: number | string;
}

// The linked receiving order header (the build flow's draft RO).
export interface JobReceiving {
  number: string;
  supplier?: string;
  eta: string | null;
}

export interface JobBuilderData {
  run: JobRun;
  // Optional context. Widened to include undefined so callers can pass an
  // unresolved query result directly under exactOptionalPropertyTypes.
  projectName?: string | undefined;
  customerName?: string | undefined;
  family?: string | undefined;
  // Output units from the quote; drives the inbound rollup and floor counts.
  outputUnits: number;
  materials: JobMaterial[];
  receivingOrder: JobReceiving | null;
  labels: JobRunLabel[];
  sowSteps: JobRunSowStep[];
  timeline: JobRunTimeline | null;
  jacket: JobRunJacket | null;
}

function toBomItem(m: JobMaterial): BomItem {
  return {
    sku: m.sku ?? '',
    itemNo: m.itemNo ?? m.itemId,
    desc: m.desc ?? '',
    weight: m.weight ?? '',
    dims: m.dims ?? '',
    perUnit: String(m.perUnit),
  };
}

// Build the `Job` jobLogic consumes. Dates are normalized to '' when absent so
// the date helpers (parseDate / dayDiff) treat them as unset rather than NaN.
export function adaptJob(data: JobBuilderData): Job {
  const t = data.timeline;
  return {
    id: data.run.run_number ?? data.run.id,
    project: data.projectName ?? '',
    customer: data.customerName ?? '',
    family: data.family ?? '',
    mabd: t?.mabd ?? '',
    totalCents: 0,
    qty: data.outputUnits,
    released: data.run.status !== 'planned',
    items: data.materials.map(toBomItem),
    ro: {
      number: data.receivingOrder?.number ?? '',
      supplier: data.receivingOrder?.supplier ?? '',
      eta: data.receivingOrder?.eta ?? '',
    },
    labels: data.labels.map((l) => ({
      kind: l.label_kind,
      size: l.size ?? '',
      data: l.data,
      qty: String(l.qty),
    })),
    sow: data.sowSteps.map((s) => ({ process: s.title, detail: s.detail ?? '' })),
    timeline: {
      materialsEta: t?.materials_eta ?? '',
      buildStart: t?.build_start ?? '',
      buildEnd: t?.build_end ?? '',
      ship: t?.ship_date ?? '',
    },
    jacket: { approved: data.jacket?.status === 'approved' },
  };
}
