// Pure logic for the Job Builder (P0 foundation, ADR 0006): BOM rollups, the
// materials/MABD date checks, timeline scaling, readiness, and the generated
// floor task list. No React, no money, no I/O. Unit-tested in jobLogic.test.ts.
// Ported from the operator's Claude-design prototype unchanged.

import type { Job, JobTimeline } from './jobModel';

export function num(v: string | number): number {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isNaN(n) || n < 0 ? 0 : n;
}

const DAY = 86_400_000;

export function parseDate(s: string): Date | null {
  const x = new Date((s || '') + 'T00:00:00');
  return Number.isNaN(x.getTime()) ? null : x;
}

export function fmtDate(s: string): string {
  const x = parseDate(s);
  return x ? x.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
}

/** Whole days from a to b, or null if either is unparseable. */
export function dayDiff(a: string, b: string): number | null {
  const x = parseDate(a);
  const y = parseDate(b);
  return x && y ? Math.round((y.getTime() - x.getTime()) / DAY) : null;
}

export function extendedQty(perUnit: string, units: number): number {
  return num(perUnit) * units;
}

export function totalInboundUnits(job: Job): number {
  const units = num(job.qty);
  return job.items.reduce((a, it) => a + num(it.perUnit) * units, 0);
}

export interface EtaCheck {
  ok: boolean;
  slack: number | null;
  label: string;
}

export function etaCheck(roEta: string, buildStart: string): EtaCheck {
  const slack = dayDiff(roEta, buildStart);
  const ok = slack != null && slack >= 0;
  const label = !roEta
    ? 'No ETA set'
    : slack == null
      ? 'Set a build start date to check'
      : ok
        ? `Arrives ${slack}d before build start`
        : `Arrives ${Math.abs(slack)}d after build start`;
  return { ok, slack, label };
}

export interface ScheduleCheck {
  onTrack: boolean;
  buildOk: boolean;
  buildOrderOk: boolean;
  allGreen: boolean;
  shipSlack: number | null;
  statusBig: 'Set ship date' | 'On track' | 'Check sequence' | 'At risk';
  statusDetail: string;
}

export function scheduleCheck(timeline: JobTimeline, mabd: string, roEta: string): ScheduleCheck {
  const { buildStart, buildEnd, ship } = timeline;
  const shipSlack = dayDiff(ship, mabd);
  const onTrack = shipSlack != null && shipSlack >= 0;
  const buildBeforeShip = dayDiff(buildEnd, ship);
  const buildOrderDiff = dayDiff(buildStart, buildEnd);
  const buildOrderOk = buildOrderDiff == null || buildOrderDiff >= 0;
  const buildOk = (buildBeforeShip == null || buildBeforeShip >= 0) && buildOrderOk;
  const etaOk = etaCheck(roEta, buildStart).ok;
  const allGreen = onTrack && buildOk && etaOk;
  const statusBig = !ship ? 'Set ship date' : allGreen ? 'On track' : onTrack ? 'Check sequence' : 'At risk';
  const statusDetail = !ship
    ? 'Add a ship date to check against MABD.'
    : onTrack
      ? `Ship ${shipSlack}d before MABD (${fmtDate(mabd)}).`
      : `Ship ${Math.abs(shipSlack as number)}d past MABD (${fmtDate(mabd)}).`;
  return { onTrack, buildOk, buildOrderOk, allGreen, shipSlack, statusBig, statusDetail };
}

export interface TimelineScale {
  matPct: number;
  shipPct: number;
  mabdPct: number;
  buildLeft: number;
  buildWidth: number;
}

// Map the timeline dates to 0-100% positions on a bar padded +/- 3 days.
export function timelineScale(timeline: JobTimeline, mabd: string): TimelineScale {
  const { materialsEta, buildStart, buildEnd, ship } = timeline;
  const dates = [materialsEta, buildStart, buildEnd, ship, mabd].map(parseDate).filter((d): d is Date => d != null);
  const pad = 3 * DAY;
  const fallback = parseDate(mabd);
  let minD = dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : fallback;
  let maxD = dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : fallback;
  if (minD) minD = new Date(minD.getTime() - pad);
  if (maxD) maxD = new Date(maxD.getTime() + pad);
  const span = minD && maxD ? Math.max(1, (maxD.getTime() - minD.getTime()) / DAY) : 1;
  const pct = (s: string): number => {
    const x = parseDate(s);
    return x && minD ? Math.max(0, Math.min(100, ((x.getTime() - minD.getTime()) / DAY / span) * 100)) : 0;
  };
  const buildLeft = pct(buildStart);
  return {
    matPct: pct(materialsEta),
    shipPct: pct(ship),
    mabdPct: pct(mabd),
    buildLeft,
    buildWidth: Math.max(0, pct(buildEnd) - buildLeft),
  };
}

export interface Milestone {
  label: string;
  dateStr: string;
  flag: string;
  ok: boolean | null; // null = neutral target
}

export function milestones(timeline: JobTimeline, mabd: string, roEta: string): Milestone[] {
  const { materialsEta, buildStart, buildEnd, ship } = timeline;
  const eta = etaCheck(roEta, buildStart);
  const sched = scheduleCheck(timeline, mabd, roEta);
  return [
    { label: 'Materials ETA', dateStr: fmtDate(materialsEta), flag: eta.ok ? 'Clears build' : 'Tight', ok: eta.ok },
    {
      label: 'Build window',
      dateStr: `${fmtDate(buildStart)} → ${fmtDate(buildEnd)}`,
      flag: sched.buildOk ? 'Before ship' : !sched.buildOrderOk ? 'End before start' : 'Overruns ship',
      ok: sched.buildOk,
    },
    { label: 'Ship date', dateStr: fmtDate(ship), flag: sched.onTrack ? 'Meets MABD' : 'Past MABD', ok: sched.onTrack },
    { label: 'MABD / Target', dateStr: fmtDate(mabd), flag: 'Target', ok: null },
  ];
}

export interface ReadinessCheck {
  label: string;
  ok: boolean;
}

export function readinessChecks(job: Job): { checks: ReadinessCheck[]; readyCount: number } {
  const { materialsEta, buildStart, buildEnd, ship } = job.timeline;
  const checks: ReadinessCheck[] = [
    { label: 'BOM defined', ok: job.items.length > 0 },
    { label: 'Receiving order set', ok: !!job.ro.eta },
    { label: 'Labels defined', ok: job.labels.length > 0 },
    { label: 'Scope of work', ok: job.sow.length > 0 },
    { label: 'Timeline complete', ok: [materialsEta, buildStart, buildEnd, ship].every(Boolean) },
  ];
  return { checks, readyCount: checks.filter((c) => c.ok).length };
}

export interface FloorTask {
  id: string;
  area: string;
  label: string;
}

// The internal floor task list, generated from the build definition.
export function buildTaskList(job: Job): FloorTask[] {
  const units = num(job.qty).toLocaleString();
  const inbound = totalInboundUnits(job).toLocaleString();
  const tasks: FloorTask[] = [
    { id: 'recv', area: 'Receiving', label: `Receive & verify inbound against ${job.ro.number}` },
    { id: 'stage', area: 'Staging', label: `Stage ${job.items.length} BOM components (${inbound} units total)` },
  ];
  job.sow.forEach((w, i) => tasks.push({ id: 'sow' + i, area: 'Build', label: w.process + (w.detail ? ` — ${w.detail}` : '') }));
  job.labels.forEach((lb, i) => tasks.push({ id: 'lbl' + i, area: 'Labeling', label: `Print & apply ${lb.kind} label (${lb.size}) x${lb.qty}` }));
  tasks.push({ id: 'qc', area: 'QC', label: `Final QC & count to ${units} output units` });
  if (job.timeline.ship) tasks.push({ id: 'ship', area: 'Shipping', label: `Pack, palletize & ship by ${fmtDate(job.timeline.ship)}` });
  return tasks;
}

export function isPosted(job: Job): boolean {
  return !!job.jacket?.approved;
}
