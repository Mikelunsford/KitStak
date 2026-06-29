// Job Builder model types and label constants (P0 foundation, ADR 0006).
//
// Ported from the operator's Claude-design prototype, stripped of the prototype
// seed data (CANONICAL_JOBS / BUILD_DETAIL): the real job identity and build
// plan come from the backend in later phases. This module is the shared shape
// the pure job logic (jobLogic.ts) and the P2 surfaces compute against. Grid
// numbers are kept as strings (parsed at compute time) exactly as the source.

export interface BomItem {
  sku: string;
  itemNo: string;
  desc: string;
  weight: string;
  dims: string;
  perUnit: string;
}

export interface ReceivingOrder {
  number: string;
  supplier: string;
  eta: string; // yyyy-mm-dd
}

export type LabelKind = 'UPC' | 'Descriptive' | 'Warning' | 'Shipping' | 'Compliance' | 'Lot / Date' | 'Custom';

export interface JobLabel {
  kind: string;
  size: string;
  data: Record<string, string>;
  qty: string;
}

export interface SowStep {
  process: string;
  detail: string;
}

export interface JobTimeline {
  materialsEta: string;
  buildStart: string;
  buildEnd: string;
  ship: string;
}

export interface Jacket {
  approved: boolean;
  approvedBy?: string;
  approvedDate?: string;
}

// The build-phase shape of a job: identity plus the BOM/receiving/labels/SOW/
// timeline/jacket build plan. `totalCents` carries the quote total in the
// money model's integer cents (not surfaced in the build logic).
export interface Job {
  id: string;
  project: string;
  customer: string;
  family: string;
  mabd: string; // Must-Arrive-By Date, yyyy-mm-dd
  totalCents: number;
  qty: number; // output units
  released: boolean;
  items: BomItem[];
  ro: ReceivingOrder;
  labels: JobLabel[];
  sow: SowStep[];
  timeline: JobTimeline;
  jacket?: Jacket;
  tasksDone?: Record<string, boolean>;
}

export interface LabelFieldDef {
  key: string;
  label: string;
  ph?: string;
  type?: string;
}

export const LABEL_KINDS: LabelKind[] = ['UPC', 'Descriptive', 'Warning', 'Shipping', 'Compliance', 'Lot / Date', 'Custom'];

export const LABEL_SIZES: string[] = ['1x1', '2x1', '2x2', '3x2', '4x3', '4x6', '6x4', '8x10', 'Custom'];

// Per label kind, the actual customer-supplied fields printed on it.
export const LABEL_FIELD_DEFS: Record<string, LabelFieldDef[]> = {
  UPC: [{ key: 'code', label: 'UPC / GTIN code', ph: '810001192034' }],
  Descriptive: [{ key: 'description', label: 'Description', ph: 'Product description as printed' }],
  Warning: [{ key: 'warning', label: 'Warning text', ph: 'e.g. Choking hazard - small parts' }],
  Shipping: [
    { key: 'shipTo', label: 'Ship to', ph: 'Destination / store #' },
    { key: 'address', label: 'Address', ph: 'Street, city, ST ZIP' },
  ],
  Compliance: [{ key: 'statement', label: 'Compliance statement', ph: 'Prop 65, FCC ID, cert #' }],
  'Lot / Date': [
    { key: 'lot', label: 'Lot / batch #', ph: 'LOT-00000' },
    { key: 'date', label: 'Date', type: 'date' },
  ],
  Custom: [{ key: 'custom', label: 'Captured data', ph: 'Information recorded on this label' }],
};

export function labelFieldsFor(kind: string): LabelFieldDef[] {
  return LABEL_FIELD_DEFS[kind] ?? LABEL_FIELD_DEFS.Custom;
}
