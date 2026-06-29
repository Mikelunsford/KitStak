// Assemble the live JobBuilderData for one job_run: the run itself, its project
// (name + customer + due date), the project materials (BOM source), the linked
// receiving order, and the four run-scoped build artifacts. adaptJob turns this
// into the ported jobLogic `Job` so the readiness rail / schedule check / floor
// task list run unchanged. ADR 0006 P2c.
//
// A Kitstak project is multi-line with no single "output unit" count, so
// outputUnits is 1 and each project line's quantity becomes its perUnit. The
// inbound rollup (totalInboundUnits) then reads as the BOM unit total, which is
// what the rail surfaces.

import { useJobRun } from '@/lib/hooks/useJobRuns';
import {
  useJobRunLabels,
  useJobRunSowSteps,
  useJobRunTimeline,
  useJobRunJacket,
} from '@/lib/hooks/useJobArtifacts';
import { useProject, useProjectLineItems } from '@/lib/hooks/useProjects';
import { useCustomer } from '@/lib/hooks/useCustomer';
import { useReceivingOrdersList } from '@/lib/hooks/useOps';
import { adaptJob, type JobBuilderData, type JobMaterial } from '@/lib/jobbuilder/jobAdapter';
import type { Job } from '@/lib/jobbuilder/jobModel';
import type { ReceivingOrder } from '@/lib/services/receivingOrdersService';
import type { ProjectLineItem } from '@/lib/types/sales';
import type { JobRunLabel, JobRunSowStep, JobRunJacket } from '@/lib/types/jobbuilder';

export interface JobBuilderBundle {
  job: Job;
  projectId: string | null;
  materials: JobMaterial[];
  receivingOrder: ReceivingOrder | null;
  receivingOrderId: string | null;
  // Raw canon artifact rows for the editing tabs (the adapted job above is for
  // the pure logic; the tabs CRUD the rows directly).
  labelRows: JobRunLabel[];
  sowRows: JobRunSowStep[];
  jacketRow: JobRunJacket | null;
  isLoading: boolean;
  notFound: boolean;
}

function toMaterials(lines: ProjectLineItem[] | undefined): JobMaterial[] {
  return (lines ?? [])
    .filter((l) => l.item_id !== null)
    .map((l) => ({
      itemId: l.item_id as string,
      desc: l.name,
      perUnit: l.quantity,
    }));
}

export function useJobBuilderData(runId: string | undefined): JobBuilderBundle {
  const runQ = useJobRun(runId);
  const projectId = runQ.data?.project_id ?? null;

  const projectQ = useProject(projectId ?? undefined);
  const linesQ = useProjectLineItems(projectId ?? undefined);
  const project = projectQ.data?.project ?? null;
  const customerQ = useCustomer(project?.customer_id ?? undefined);
  const receivingQ = useReceivingOrdersList(projectId ? { project_id: projectId } : {});
  const labelsQ = useJobRunLabels(runId);
  const sowQ = useJobRunSowSteps(runId);
  const timelineQ = useJobRunTimeline(runId);
  const jacketQ = useJobRunJacket(runId);

  const run = runQ.data;
  const receivingOrder = (receivingQ.data ?? [])[0] ?? null;
  const materials = toMaterials(linesQ.data);

  const isLoading =
    runQ.isLoading || labelsQ.isLoading || sowQ.isLoading ||
    timelineQ.isLoading || jacketQ.isLoading;

  const labelRows = labelsQ.data ?? [];
  const sowRows = sowQ.data ?? [];
  const jacketRow = jacketQ.data ?? null;

  if (!run) {
    return {
      job: EMPTY_JOB,
      projectId,
      materials: [],
      receivingOrder: null,
      receivingOrderId: null,
      labelRows: [],
      sowRows: [],
      jacketRow: null,
      isLoading,
      notFound: !runQ.isLoading && !run,
    };
  }

  const data: JobBuilderData = {
    run,
    projectName: project?.name,
    customerName: customerQ.data?.display_name,
    family: undefined,
    outputUnits: 1,
    materials,
    receivingOrder: receivingOrder
      ? { number: receivingOrder.receiving_number ?? '', eta: receivingOrder.expected_date ?? null }
      : null,
    labels: labelsQ.data ?? [],
    sowSteps: sowQ.data ?? [],
    timeline: timelineQ.data ?? null,
    jacket: jacketQ.data ?? null,
  };

  return {
    job: adaptJob(data),
    projectId,
    materials,
    receivingOrder,
    receivingOrderId: receivingOrder?.id ?? null,
    labelRows,
    sowRows,
    jacketRow,
    isLoading,
    notFound: false,
  };
}

// A stable placeholder Job while the run loads, so the detail view can render
// its frame without a null guard at every read.
const EMPTY_JOB: Job = {
  id: '', project: '', customer: '', family: '', mabd: '', totalCents: 0, qty: 0,
  released: false, items: [], ro: { number: '', supplier: '', eta: '' },
  labels: [], sow: [], timeline: { materialsEta: '', buildStart: '', buildEnd: '', ship: '' },
  jacket: { approved: false },
};
