// Estimate Engine rate card (P0 foundation, ADR 0006).
//
// Rates are sub-cent (a labor rate of $25/hr yields a per-unit cost near
// $0.18), so every rate is stored as `rateMicros`: millionths of a currency
// unit. $25.00 = 25_000_000 micros; $0.10 = 100_000 micros; $0.0025 = 2_500.
// Micros convert to integer cents by dividing by 10_000 (1 cent = 10_000
// micros), with banker's rounding applied only at the final per-line total.
//
// This DEFAULT_RATE_CARD is the seed for the per-org rate_cards table that
// lands in P1; the values below are sensible defaults the operator edits there.
// Codes the pricing engine reads (engine.ts): CON-LABOR, CON-TOUCH, RCV-*,
// MAT-PALLET-*, SHP-WRAP, ADD-LABEL-APP, STO-T1..T3, ECM-*, ADM-*.

export type RateGroup =
  | 'constants'
  | 'receiving'
  | 'storage'
  | 'shipping'
  | 'ecommerce'
  | 'admin'
  | 'materials'
  | 'addons';

export interface RateCardLine {
  code: string;
  group: RateGroup;
  label: string;
  /** Rate in micros (millionths of a currency unit). */
  rateMicros: number;
}

/** Micros per whole currency unit, and per cent, for readable literals. */
export const MICROS_PER_UNIT = 1_000_000;
export const MICROS_PER_CENT = 10_000;

/** Build a rate-card line from a plain dollar figure (authoring convenience). */
function dollars(code: string, group: RateGroup, label: string, usd: number): RateCardLine {
  return { code, group, label, rateMicros: Math.round(usd * MICROS_PER_UNIT) };
}

export const DEFAULT_RATE_CARD: readonly RateCardLine[] = [
  // Cost & labor constants
  dollars('CON-LABOR', 'constants', 'Fully-burdened labor (per hour)', 25),
  dollars('CON-TOUCH', 'constants', 'Per-touch labor', 0.1),
  // Receiving / inbound
  dollars('RCV-PALLET', 'receiving', 'Inbound pallet', 5.5),
  dollars('RCV-CASE-U40', 'receiving', 'Inbound case (under 40 lb)', 1.25),
  dollars('RCV-CASE-O40', 'receiving', 'Inbound case (over 40 lb)', 2.0),
  // Storage (per pallet / month)
  dollars('STO-T1', 'storage', 'Storage 1-99 pallets', 16),
  dollars('STO-T2', 'storage', 'Storage 100-499 pallets', 13.5),
  dollars('STO-T3', 'storage', 'Storage 500+ pallets', 11),
  // Shipping / outbound
  dollars('SHP-WRAP', 'shipping', 'Pallet wrap & processing', 5),
  // E-commerce / fulfillment
  dollars('ECM-ORDER', 'ecommerce', 'E-com order (pull, pack, doc)', 3.25),
  dollars('ECM-PIECE', 'ecommerce', 'Additional piece pulled', 0.35),
  // Administration
  dollars('ADM-PROG', 'admin', 'Programming / WMS config (per hour)', 95),
  dollars('ADM-SHOP', 'admin', 'Shop hours (billable, per hour)', 65),
  dollars('ADM-SETUP', 'admin', 'New account setup (one-time)', 250),
  // Materials & pallets
  dollars('MAT-PALLET-A', 'materials', 'Pallet, Grade A / CHEP', 18),
  dollars('MAT-PALLET-B', 'materials', 'Pallet, Grade B', 13),
  // Add-ons & change charges
  dollars('ADD-LABEL-APP', 'addons', 'Label print & apply', 0.12),
];

/** Look up a rate (micros) by code; missing codes price at 0, never throw. */
export function rateMicrosOf(card: readonly RateCardLine[], code: string): number {
  const hit = card.find((c) => c.code === code);
  return hit && Number.isFinite(hit.rateMicros) && hit.rateMicros >= 0 ? hit.rateMicros : 0;
}
