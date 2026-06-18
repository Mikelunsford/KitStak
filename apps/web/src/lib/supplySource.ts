// Supply-source presentation helpers (F-UIUX-ENTITYPICKER-SUPPLY-SOURCE-01).
// The enum itself is the canonical ItemSupplySourceSchema in lib/types/sales;
// this module only carries the humanized labels and the zero-cost predicate so
// the item forms, the picker, and cost display share one source of truth. The
// zero-cost set mirrors the edge folds (dashboard-api) and the job-profitability
// view (migration 0122): customer_supplied and third_party_consigned are
// material the org neither owns nor pays for, so they roll up as zero org cost.

import type { ItemSupplySource } from '@/lib/types/sales';

export const SUPPLY_SOURCE_LABEL: Record<ItemSupplySource, string> = {
  in_house: 'In-house',
  customer_supplied: 'Customer supplied',
  vendor_consigned: 'Vendor consigned',
  third_party_consigned: 'Third-party consigned',
};

export const SUPPLY_SOURCE_OPTIONS: ReadonlyArray<{
  value: ItemSupplySource;
  label: string;
}> = [
  { value: 'in_house', label: SUPPLY_SOURCE_LABEL.in_house },
  { value: 'customer_supplied', label: SUPPLY_SOURCE_LABEL.customer_supplied },
  { value: 'vendor_consigned', label: SUPPLY_SOURCE_LABEL.vendor_consigned },
  {
    value: 'third_party_consigned',
    label: SUPPLY_SOURCE_LABEL.third_party_consigned,
  },
];

const ZERO_COST_SOURCES: ReadonlySet<ItemSupplySource> = new Set<ItemSupplySource>(
  ['customer_supplied', 'third_party_consigned'],
);

/**
 * True when material of this source rolls up as zero org material cost. Mirrors
 * the edge cost folds and the job-profitability view zeroing predicate.
 */
export function isZeroCostSupplySource(source: ItemSupplySource): boolean {
  return ZERO_COST_SOURCES.has(source);
}
