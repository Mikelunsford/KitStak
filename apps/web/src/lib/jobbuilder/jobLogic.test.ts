import { describe, it, expect } from 'vitest';

import {
  num,
  dayDiff,
  extendedQty,
  totalInboundUnits,
  etaCheck,
  scheduleCheck,
  timelineScale,
  milestones,
  readinessChecks,
  buildTaskList,
} from './jobLogic';
import type { Job, JobTimeline } from './jobModel';

// Inline fixture (the prototype's CANONICAL_JOBS seed is not ported; real jobs
// come from the backend in P2). A fully-defined display-build job, mabd after
// the ship date so the default timeline reads On track.
const northwind: Job = {
  id: 'JOB-1041',
  project: 'Northwind Endcap Program',
  customer: 'Northwind Apparel Co.',
  family: 'display',
  mabd: '2026-08-31',
  totalCents: 418_800,
  qty: 1131,
  released: false,
  items: [
    { sku: 'DSP-BASE-01', itemNo: '80021', desc: 'Sidekick base, B-flute', weight: '1.2', dims: '24x8x60', perUnit: '1' },
    { sku: 'DSP-CLIP-01', itemNo: '80022', desc: 'Clip strip, 12-station', weight: '0.3', dims: '2x2x36', perUnit: '1' },
    { sku: 'DSP-HDR-01', itemNo: '80023', desc: 'Header card, 4c print', weight: '0.1', dims: '24x1x8', perUnit: '1' },
  ],
  ro: { number: 'RO-5043', supplier: 'Western Corrugated', eta: '2026-08-10' },
  labels: [
    { kind: 'UPC', size: '4x6', data: { code: '810001192034' }, qty: '1131' },
    { kind: 'Shipping', size: '8x10', data: { shipTo: 'Target DC-0421', address: '1000 Nicollet Mall, Minneapolis MN' }, qty: '40' },
  ],
  sow: [
    { process: 'Receive & stage components', detail: 'Verify counts vs RO-5043' },
    { process: 'Build sidekick base', detail: 'Fold, glue, set 20 min cure' },
    { process: 'Install clip strip & header', detail: 'Attach, QC each unit' },
    { process: 'Pack & palletize', detail: '40 units/pallet, stretch wrap' },
  ],
  timeline: { materialsEta: '2026-08-10', buildStart: '2026-08-17', buildEnd: '2026-08-26', ship: '2026-08-28' },
};

function tl(over: Partial<JobTimeline> = {}): JobTimeline {
  return { materialsEta: '2026-08-10', buildStart: '2026-08-17', buildEnd: '2026-08-26', ship: '2026-08-28', ...over };
}

describe('num', () => {
  it('parses and clamps negatives/NaN to 0', () => {
    expect(num('12')).toBe(12);
    expect(num('-4')).toBe(0);
    expect(num('abc')).toBe(0);
  });
});

describe('dayDiff', () => {
  it('returns whole days, null on bad input', () => {
    expect(dayDiff('2026-08-10', '2026-08-17')).toBe(7);
    expect(dayDiff('2026-08-17', '2026-08-10')).toBe(-7);
    expect(dayDiff('', '2026-08-10')).toBeNull();
  });
});

describe('BOM rollups', () => {
  it('extends per-unit by units', () => {
    expect(extendedQty('2', 1131)).toBe(2262);
  });
  it('sums inbound units across components (Northwind: 3 x 1131)', () => {
    expect(totalInboundUnits(northwind)).toBe(3393);
  });
});

describe('etaCheck', () => {
  it('flags ok when materials arrive before build start', () => {
    const r = etaCheck('2026-08-10', '2026-08-17');
    expect(r.ok).toBe(true);
    expect(r.slack).toBe(7);
    expect(r.label).toBe('Arrives 7d before build start');
  });
  it('flags late arrival', () => {
    const r = etaCheck('2026-08-20', '2026-08-17');
    expect(r.ok).toBe(false);
    expect(r.label).toBe('Arrives 3d after build start');
  });
  it('handles missing eta', () => {
    expect(etaCheck('', '2026-08-17').label).toBe('No ETA set');
  });
});

describe('scheduleCheck', () => {
  it('is On track when ship clears MABD and sequence is valid (Northwind)', () => {
    const r = scheduleCheck(tl(), northwind.mabd, '2026-08-10');
    expect(r.onTrack).toBe(true);
    expect(r.allGreen).toBe(true);
    expect(r.statusBig).toBe('On track');
  });
  it('is At risk when ship is past MABD', () => {
    const r = scheduleCheck(tl({ ship: '2026-09-05' }), northwind.mabd, '2026-08-10');
    expect(r.onTrack).toBe(false);
    expect(r.statusBig).toBe('At risk');
  });
  it('is Check sequence when ship meets MABD but build overruns ship', () => {
    const r = scheduleCheck(tl({ buildEnd: '2026-08-30', ship: '2026-08-28' }), northwind.mabd, '2026-08-10');
    expect(r.onTrack).toBe(true);
    expect(r.buildOk).toBe(false);
    expect(r.statusBig).toBe('Check sequence');
  });
  it('prompts for a ship date when missing', () => {
    expect(scheduleCheck(tl({ ship: '' }), northwind.mabd, '2026-08-10').statusBig).toBe('Set ship date');
  });
});

describe('timelineScale', () => {
  it('keeps all positions within 0-100 and orders mat < ship', () => {
    const s = timelineScale(tl(), northwind.mabd);
    for (const p of [s.matPct, s.shipPct, s.mabdPct, s.buildLeft]) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(100);
    }
    expect(s.matPct).toBeLessThan(s.shipPct);
    expect(s.buildWidth).toBeGreaterThan(0);
  });
});

describe('milestones', () => {
  it('produces 4 rows with the MABD row neutral', () => {
    const ms = milestones(tl(), northwind.mabd, '2026-08-10');
    expect(ms).toHaveLength(4);
    expect(ms[3]).toMatchObject({ label: 'MABD / Target', ok: null });
  });
});

describe('readinessChecks', () => {
  it('counts the fully-defined fixture job as 5/5', () => {
    expect(readinessChecks(northwind).readyCount).toBe(5);
  });
  it('drops to 4 when labels are removed', () => {
    const j: Job = { ...northwind, labels: [] };
    expect(readinessChecks(j).readyCount).toBe(4);
    expect(readinessChecks(j).checks.find((c) => c.label === 'Labels defined')?.ok).toBe(false);
  });
});

describe('buildTaskList', () => {
  it('generates recv -> stage -> build(per SOW) -> label(per label) -> qc -> ship', () => {
    const tasks = buildTaskList(northwind);
    const areas = tasks.map((t) => t.area);
    expect(areas[0]).toBe('Receiving');
    expect(areas[1]).toBe('Staging');
    expect(areas.filter((a) => a === 'Build')).toHaveLength(northwind.sow.length);
    expect(areas.filter((a) => a === 'Labeling')).toHaveLength(northwind.labels.length);
    expect(areas).toContain('QC');
    expect(areas[areas.length - 1]).toBe('Shipping');
  });
  it('omits the ship task when no ship date', () => {
    const j: Job = { ...northwind, timeline: { ...northwind.timeline, ship: '' } };
    expect(buildTaskList(j).some((t) => t.area === 'Shipping')).toBe(false);
  });
});
