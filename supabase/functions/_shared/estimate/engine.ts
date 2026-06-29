// Pure pricing core for the Estimate Engine (P0 foundation, ADR 0006).
//
// Ported from the operator's Claude-design prototype and converted to the
// constitution's money model: rate-card rates are micros (millionths of a
// currency unit), and every persisted/emitted monetary value is an integer
// number of cents produced by roundHalfEven (banker's rounding). No float
// reaches a money field. Intermediate per-unit values are kept in micros so the
// sub-cent precision the estimator needs survives until the final line total.
//
// Model: a job's FAMILY picks the pricing ENGINE and a default set of rate-card
// line items (families.ts). Three engines do real math (time-study, touch,
// per-piece); menu/flat families price purely from line items. A $500 project
// minimum floors small jobs; time-study sells must clear a 2.5x labor-cost floor.

// DENO MIRROR of apps/web/src/lib/estimate/engine.ts. The bodies are kept in
// lockstep; only the three import specifiers differ (Deno requires the .ts
// extension and resolves money one directory up, not via the @ alias). The pure
// config files (families.ts, rateCard.ts) are byte-identical copies asserted by
// the contract byte-parity test; the engine math is asserted identical by the
// behaviour-parity test (estimate-engine.parity.test.ts).
import { roundHalfEven } from '../money.ts';

import {
  FAMILIES,
  type EngineKind,
  type FamilyKey,
  type InboundMode,
  type PalletGrade,
} from './families.ts';
import {
  MICROS_PER_CENT,
  rateMicrosOf,
  type RateCardLine,
} from './rateCard.ts';

export interface EstimateInput {
  family: FamilyKey;
  engine: EngineKind;
  qty: number;
  // time-study
  studyMin: number;
  studySec: number;
  inflationPct: number;
  markup: number;
  // touch
  touches: number;
  // per-piece (operator-entered sell price, in micros)
  baseRateMicros: number;
  // rate-card line quantities
  inboundPallets: number;
  inboundMode: InboundMode;
  palletsOut: number;
  palletGrade: PalletGrade;
  labelQty: number;
  storagePallets: number;
  storageMonths: number;
  ecomOrders: number;
  ecomPieces: number;
  programmingHrs: number;
  shopHours: number;
  setupOn: boolean;
}

export interface EstimateLineItem {
  label: string;
  detail: string;
  /** Integer cents. */
  amountCents: number;
}

export interface EstimateResult {
  productionItems: EstimateLineItem[];
  passThroughItems: EstimateLineItem[];
  productionCents: number;
  passThroughCents: number;
  rawCents: number;
  totalCents: number;
  minApplied: boolean;
  hasProduction: boolean;
  // Per-unit values stay in micros (sub-cent precision for the margin check).
  colPerUnitMicros: number;
  sellPerUnitMicros: number;
  profitPerUnitMicros: number;
  marginOk: boolean;
}

/** Project pricing constants (from the rate-card guide). */
export const MIN_PROJECT_CENTS = 50_000; // $500.00
export const MARGIN_FLOOR = 2.5;

/** Clamp any numeric input to a safe, non-negative number. */
function safe(n: number): number {
  return !Number.isFinite(n) || n < 0 ? 0 : n;
}

/** Reduce a total micros figure to integer cents with banker's rounding. */
function microsToCents(micros: number): number {
  return roundHalfEven(safe(micros) / MICROS_PER_CENT);
}

/** Format a micros value as a dollar string for cosmetic line detail. */
function fmtMicros(micros: number): string {
  return '$' + (micros / 1_000_000).toFixed(4).replace(/0+$/, '').replace(/\.$/, '.00');
}

/** Format an integer cents value as a dollar string for cosmetic line detail. */
function fmtCents(cents: number): string {
  return '$' + (cents / 100).toFixed(2);
}

/** Compute the full estimate from inputs + the active rate card. Pure. */
export function computeEstimate(input: EstimateInput, card: readonly RateCardLine[]): EstimateResult {
  const fam = FAMILIES[input.family] ?? FAMILIES.display;
  const engine = input.engine || fam.engine;

  const qty = safe(input.qty);
  const rawSec = safe(input.studyMin) * 60 + safe(input.studySec);
  const inflation = safe(input.inflationPct);
  const markup = safe(input.markup);
  const touches = safe(input.touches);
  const laborMicros = rateMicrosOf(card, 'CON-LABOR');
  const touchMicros = rateMicrosOf(card, 'CON-TOUCH');

  // ----- Production engine (time-study / touch / per-piece) -----
  const inflatedSec = rawSec * (1 + inflation / 100);
  let colPerUnitMicros = 0;
  let sellPerUnitMicros = 0;
  let prodLabel = '';
  let prodDetail = '';

  if (engine === 'timestudy') {
    colPerUnitMicros = (inflatedSec / 3600) * laborMicros;
    sellPerUnitMicros = colPerUnitMicros * markup;
    prodLabel = 'Production / assembly (all-in)';
    prodDetail = `${qty.toLocaleString()} units × ${fmtMicros(sellPerUnitMicros)} (COL ${fmtMicros(colPerUnitMicros)} × ${markup})`;
  } else if (engine === 'touch') {
    sellPerUnitMicros = touches * touchMicros;
    prodLabel = 'Touch-based assembly';
    prodDetail = `${qty.toLocaleString()} units × ${touches} touches × ${fmtMicros(touchMicros)}`;
  } else if (engine === 'perpiece') {
    sellPerUnitMicros = safe(input.baseRateMicros);
    prodLabel = 'Per-piece processing';
    prodDetail = `${qty.toLocaleString()} pieces × ${fmtMicros(sellPerUnitMicros)}`;
  }

  const hasProduction = engine === 'timestudy' || engine === 'touch' || engine === 'perpiece';
  const profitPerUnitMicros = sellPerUnitMicros - colPerUnitMicros;
  const productionCents = hasProduction ? microsToCents(sellPerUnitMicros * qty) : 0;
  const productionItems: EstimateLineItem[] = hasProduction
    ? [{ label: prodLabel, detail: prodDetail, amountCents: productionCents }]
    : [];

  // ----- Rate-card line items (only the family's lines, only when > 0) -----
  const passThroughItems: EstimateLineItem[] = [];
  const nInb = safe(input.inboundPallets);
  const nOut = safe(input.palletsOut);
  const nLbl = safe(input.labelQty);
  const nStoP = safe(input.storagePallets);
  const nStoM = safe(input.storageMonths);
  const nEcoO = safe(input.ecomOrders);
  const nEcoP = safe(input.ecomPieces);
  const nProg = safe(input.programmingHrs);
  const nShop = safe(input.shopHours);

  const pgCode = input.palletGrade === 'a' ? 'MAT-PALLET-A' : 'MAT-PALLET-B';
  const pgLabel = input.palletGrade === 'a' ? 'Grade A / CHEP' : 'Grade B';
  const rcvCode = input.inboundMode === 'case' ? 'RCV-CASE-U40' : input.inboundMode === 'case_heavy' ? 'RCV-CASE-O40' : 'RCV-PALLET';
  const rcvUnit = input.inboundMode === 'pallet' ? 'pallet' : 'case';
  const storTier = nStoP >= 500 ? 'STO-T3' : nStoP >= 100 ? 'STO-T2' : 'STO-T1';
  const storTierLabel = nStoP >= 500 ? '500+' : nStoP >= 100 ? '100-499' : '1-99';

  const line = (label: string, detail: string, micros: number): void => {
    passThroughItems.push({ label, detail, amountCents: microsToCents(micros) });
  };

  for (const key of fam.lines) {
    if (key === 'inbound' && nInb > 0) {
      const r = rateMicrosOf(card, rcvCode);
      line('Inbound receiving', `${nInb} × ${fmtMicros(r)} / ${rcvUnit}`, r * nInb);
    } else if (key === 'palletsOut' && nOut > 0) {
      const rp = rateMicrosOf(card, pgCode);
      const rw = rateMicrosOf(card, 'SHP-WRAP');
      line(`Shipping pallets (${pgLabel})`, `${nOut} × ${fmtMicros(rp)}`, rp * nOut);
      line('Pallet wrap & processing', `${nOut} × ${fmtMicros(rw)}`, rw * nOut);
    } else if (key === 'labelQty' && nLbl > 0) {
      const r = rateMicrosOf(card, 'ADD-LABEL-APP');
      line('Additional labels', `${nLbl} × ${fmtMicros(r)}`, r * nLbl);
    } else if (key === 'storagePallets' && nStoP > 0) {
      const r = rateMicrosOf(card, storTier);
      line(`Storage (${storTierLabel} pallets)`, `${nStoP} × ${nStoM} mo × ${fmtMicros(r)}`, r * nStoP * nStoM);
    } else if (key === 'ecomOrders' && nEcoO > 0) {
      const r = rateMicrosOf(card, 'ECM-ORDER');
      line('E-com orders (pull+pack+doc)', `${nEcoO} × ${fmtMicros(r)}`, r * nEcoO);
    } else if (key === 'ecomPieces' && nEcoP > 0) {
      const r = rateMicrosOf(card, 'ECM-PIECE');
      line('Additional pieces pulled', `${nEcoP} × ${fmtMicros(r)}`, r * nEcoP);
    } else if (key === 'programmingHrs' && nProg > 0) {
      const r = rateMicrosOf(card, 'ADM-PROG');
      line('Programming / WMS config', `${nProg} × ${fmtMicros(r)}`, r * nProg);
    } else if (key === 'shopHours' && nShop > 0) {
      const r = rateMicrosOf(card, 'ADM-SHOP');
      line('Shop hours (billable)', `${nShop} × ${fmtMicros(r)}`, r * nShop);
    }
  }

  if (fam.setup && input.setupOn) {
    line('New account setup', 'One-time admin', rateMicrosOf(card, 'ADM-SETUP'));
  }

  const productionTotalCents = productionItems.reduce((a, b) => a + b.amountCents, 0);
  const passThroughCents = passThroughItems.reduce((a, b) => a + b.amountCents, 0);
  const rawCents = productionTotalCents + passThroughCents;
  const minApplied = rawCents > 0 && rawCents < MIN_PROJECT_CENTS;
  const totalCents = minApplied ? MIN_PROJECT_CENTS : rawCents;
  const marginOk = engine === 'timestudy' ? sellPerUnitMicros >= MARGIN_FLOOR * colPerUnitMicros : true;

  return {
    productionItems,
    passThroughItems,
    productionCents: productionTotalCents,
    passThroughCents,
    rawCents,
    totalCents,
    minApplied,
    hasProduction,
    colPerUnitMicros,
    sellPerUnitMicros,
    profitPerUnitMicros,
    marginOk,
  };
}

export { fmtCents, fmtMicros, microsToCents };
