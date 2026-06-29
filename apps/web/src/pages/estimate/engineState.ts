// Client-side state for the Estimate Engine wizard. Pure reducer + helpers so
// the page stays declarative; all pricing math lives in @/lib/estimate/engine.
// Form fields are kept as strings (so inputs clear and type freely) and parsed
// to numbers only when assembling the EstimateInput. Money model: the per-piece
// base rate is entered in dollars and converted to micros for the engine; every
// total the engine returns is already integer cents.

import {
  FAMILIES,
  type EngineKind,
  type FamilyKey,
  type InboundMode,
  type LineKey,
  type PalletGrade,
} from '@/lib/estimate/families';
import {
  MICROS_PER_UNIT,
  type RateCardLine as EngineRateCardLine,
  type RateGroup,
} from '@/lib/estimate/rateCard';
import type { EstimateInput } from '@/lib/estimate/engine';
import type {
  Estimate,
  EstimateInputs,
  RateCardLine as WireRateCardLine,
} from '@/lib/types/estimate';

export type ViewMode = 'estimate' | 'ratecard';
export type MaterialsMode = 'customer' | 'sourced';

export interface EngineState {
  step: number; // 1..4
  // classify
  projectName: string;
  customerId: string | null;
  family: FamilyKey;
  form: string;
  channel: string;
  materials: MaterialsMode;
  goLive: string;
  // pricing
  engine: EngineKind;
  qty: string;
  studyMin: string;
  studySec: string;
  inflationPct: string;
  markup: string;
  touches: string;
  baseRate: string; // dollars per piece; converted to micros for the engine
  // line items
  inboundPallets: string;
  inboundMode: InboundMode;
  palletsOut: string;
  palletGrade: PalletGrade;
  labelQty: string;
  storagePallets: string;
  storageMonths: string;
  ecomOrders: string;
  ecomPieces: string;
  programmingHrs: string;
  shopHours: string;
  setupOn: boolean;
}

export type EngineAction =
  | { type: 'patch'; patch: Partial<EngineState> }
  | { type: 'family'; family: FamilyKey };

function num(v: string): number {
  const n = parseFloat(v);
  return Number.isNaN(n) || n < 0 ? 0 : n;
}

// Sensible per-line default quantities derived from the unit count, so picking a
// family pre-fills an editable, plausible line set instead of zeros.
export function defaultLineQty(key: LineKey, units: number): number {
  switch (key) {
    case 'inbound':
      return Math.max(1, Math.round(units / 420));
    case 'palletsOut':
      return Math.max(1, Math.round(units / 250));
    case 'labelQty':
      return Math.max(1, Math.round(units));
    case 'storagePallets':
      return Math.max(1, Math.round(units / 300));
    case 'ecomOrders':
      return Math.max(1, Math.round(units));
    case 'ecomPieces':
      return Math.max(1, Math.round(units * 0.3));
    case 'programmingHrs':
      return 4;
    case 'shopHours':
      return 6;
    default:
      return 1;
  }
}

const LINE_FIELD: Record<LineKey, keyof EngineState> = {
  inbound: 'inboundPallets',
  palletsOut: 'palletsOut',
  labelQty: 'labelQty',
  storagePallets: 'storagePallets',
  ecomOrders: 'ecomOrders',
  ecomPieces: 'ecomPieces',
  programmingHrs: 'programmingHrs',
  shopHours: 'shopHours',
};

const ZEROED_LINES: Partial<EngineState> = {
  inboundPallets: '0',
  palletsOut: '0',
  labelQty: '0',
  storagePallets: '0',
  ecomOrders: '0',
  ecomPieces: '0',
  programmingHrs: '0',
  shopHours: '0',
};

// Choosing a family pre-loads its engine, facets, and a default line set.
function presetFor(family: FamilyKey, units: number): Partial<EngineState> {
  const fam = FAMILIES[family] ?? FAMILIES.display;
  const lines: Partial<EngineState> = { ...ZEROED_LINES };
  for (const key of fam.lines) {
    const field = LINE_FIELD[key];
    lines[field] = String(defaultLineQty(key, units)) as never;
  }
  return {
    ...lines,
    family,
    form: fam.form,
    channel: fam.channel,
    engine: fam.engine,
    setupOn: fam.setup,
  };
}

export function initialState(): EngineState {
  const goLive = new Date();
  goLive.setMonth(goLive.getMonth() + 2);
  return {
    step: 1,
    projectName: '',
    customerId: null,
    family: 'display',
    form: 'sidekick',
    channel: 'retail_mass',
    materials: 'customer',
    goLive: goLive.toISOString().slice(0, 10),
    engine: 'timestudy',
    qty: '1000',
    studyMin: '0',
    studySec: '20',
    inflationPct: '30',
    markup: '3',
    touches: '36',
    baseRate: '0.25',
    inboundPallets: '8',
    inboundMode: 'pallet',
    palletsOut: '40',
    palletGrade: 'b',
    labelQty: '0',
    storagePallets: '0',
    storageMonths: '1',
    ecomOrders: '0',
    ecomPieces: '0',
    programmingHrs: '0',
    shopHours: '0',
    setupOn: true,
  };
}

export function reducer(state: EngineState, action: EngineAction): EngineState {
  switch (action.type) {
    case 'patch':
      return { ...state, ...action.patch };
    case 'family':
      return { ...state, ...presetFor(action.family, num(state.qty)) };
    default:
      return state;
  }
}

/** Assemble the typed, numeric EstimateInput the pricing engine expects. */
export function toEstimateInput(state: EngineState): EstimateInput {
  return {
    family: state.family,
    engine: state.engine,
    qty: num(state.qty),
    studyMin: num(state.studyMin),
    studySec: num(state.studySec),
    inflationPct: num(state.inflationPct),
    markup: num(state.markup),
    touches: num(state.touches),
    baseRateMicros: Math.round(num(state.baseRate) * MICROS_PER_UNIT),
    inboundPallets: num(state.inboundPallets),
    inboundMode: state.inboundMode,
    palletsOut: num(state.palletsOut),
    palletGrade: state.palletGrade,
    labelQty: num(state.labelQty),
    storagePallets: num(state.storagePallets),
    storageMonths: num(state.storageMonths),
    ecomOrders: num(state.ecomOrders),
    ecomPieces: num(state.ecomPieces),
    programmingHrs: num(state.programmingHrs),
    shopHours: num(state.shopHours),
    setupOn: state.setupOn,
  };
}

/** The inputs jsonb the estimates-api stores (EstimateInput minus family/engine). */
export function toEstimateInputs(state: EngineState): EstimateInputs {
  const input: Record<string, unknown> = { ...toEstimateInput(state) };
  delete input.family;
  delete input.engine;
  return input as EstimateInputs;
}

/** Map persisted rate-card lines (wire shape) to the engine's RateCardLine. */
export function toEngineCard(lines: ReadonlyArray<WireRateCardLine>): EngineRateCardLine[] {
  return lines.map((l) => ({
    code: l.code,
    group: l.group_key as RateGroup,
    label: l.label,
    rateMicros: Number(l.rate_micros),
  }));
}

/** Seed wizard state from a saved draft estimate (for the edit path). */
export function fromEstimate(est: Estimate): EngineState {
  const base = initialState();
  const i = est.inputs;
  return {
    ...base,
    step: 1,
    projectName: est.name,
    customerId: est.customer_id,
    family: est.family,
    engine: est.engine,
    qty: String(i.qty),
    studyMin: String(i.studyMin),
    studySec: String(i.studySec),
    inflationPct: String(i.inflationPct),
    markup: String(i.markup),
    touches: String(i.touches),
    baseRate: (i.baseRateMicros / MICROS_PER_UNIT).toString(),
    inboundPallets: String(i.inboundPallets),
    inboundMode: i.inboundMode,
    palletsOut: String(i.palletsOut),
    palletGrade: i.palletGrade,
    labelQty: String(i.labelQty),
    storagePallets: String(i.storagePallets),
    storageMonths: String(i.storageMonths),
    ecomOrders: String(i.ecomOrders),
    ecomPieces: String(i.ecomPieces),
    programmingHrs: String(i.programmingHrs),
    shopHours: String(i.shopHours),
    setupOn: i.setupOn,
  };
}

export { num as parseField };
