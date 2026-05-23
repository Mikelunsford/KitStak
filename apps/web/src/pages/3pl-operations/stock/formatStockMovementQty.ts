// F-Wave9-AUDIT-V3-WAVE-E-01 (item 5): pure formatter for the
// stock_movements ledger. Storage holds quantity as a positive
// magnitude with the direction implied by movement_type; the audit
// surfaced that operators read the column as raw and can't tell at
// a glance whether 50 units of widget A landed in or out. We render
// the SAME stored value with a +/- prefix derived from movement_type
// so the ledger reads like the bank statement it actually is.
//
// Storage shape unchanged. Movement type → sign mapping is
// derived from the same triggers that emit movements (receiving
// orders, production runs, shipments). If a future migration
// introduces a new movement_type, the default branch returns the
// raw value with no sign prefix rather than guessing wrong.

import type {
  StockMovement,
  StockMovementType,
} from '@/lib/types/vendors_inventory_ops';

/**
 * Returns -1 for outbound flows, +1 for inbound, 0 for adjustments
 * (the trigger emits adjustments as signed already, so we trust the
 * stored value).
 */
export function signForMovementType(type: StockMovementType): -1 | 0 | 1 {
  switch (type) {
    case 'receipt':
    case 'production_produced':
    case 'transfer_in':
      return 1;
    case 'shipment':
    case 'production_consumed':
    case 'transfer_out':
      return -1;
    case 'adjustment':
      // adjustments are emitted with their own sign already; do not
      // re-flip them.
      return 0;
  }
}

/**
 * Renders the stored quantity with a leading + or - based on the
 * movement_type. Adjustments pass through unchanged so a negative
 * adjustment stays negative.
 *
 * Pure: takes the row, returns the string. Caller decides how to
 * style it (the page renders inbound flows in ink and outbound flows
 * in accent so positive vs negative carries visual signal too).
 */
export function formatStockMovementQty(
  row: Pick<StockMovement, 'movement_type' | 'quantity'>,
): string {
  const sign = signForMovementType(row.movement_type);
  // Strip a stored negative sign so we never end up with `--5`.
  const raw = String(row.quantity);
  const magnitude = raw.startsWith('-') ? raw.slice(1) : raw;
  if (sign === 0) return raw;
  if (sign === 1) return `+${magnitude}`;
  return `-${magnitude}`;
}
