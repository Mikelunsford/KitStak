// Estimate Engine family / engine taxonomy (P0 foundation, ADR 0006).
//
// A job's FAMILY selects the pricing ENGINE and a default set of rate-card line
// items. FACETS (form, channel) only describe and tag it. This taxonomy is
// configuration, not hardcoded into the pricing core, so a manufacturing family
// (or any other pillar) can be added here without touching engine.ts.

export type EngineKind = 'timestudy' | 'touch' | 'perpiece' | 'menu' | 'flat';

export type FamilyKey =
  | 'display'
  | 'copack'
  | 'kitting'
  | 'fulfillment'
  | 'warehousing'
  | 'valueadd'
  | 'admin'
  // Manufacturing pillar (ADR 0006 P3). Added through this config seam alone:
  // each reuses an existing engine and the existing line vocabulary, so the
  // pricing core (engine.ts) is untouched. Manufacturing-specific pricing
  // primitives (machine hours, raw materials) would be a separate engine phase.
  | 'mfg_production'
  | 'mfg_assembly'
  | 'mfg_machining'
  | 'mfg_finishing'
  | 'mfg_shop';

export type LineKey =
  | 'inbound'
  | 'palletsOut'
  | 'labelQty'
  | 'storagePallets'
  | 'ecomOrders'
  | 'ecomPieces'
  | 'programmingHrs'
  | 'shopHours';

export type InboundMode = 'pallet' | 'case' | 'case_heavy';
export type PalletGrade = 'a' | 'b';

export interface FamilyDef {
  key: FamilyKey;
  label: string;
  engine: EngineKind;
  form: string;
  channel: string;
  uom: string;
  lines: LineKey[];
  setup: boolean;
}

export const FAMILIES: Record<FamilyKey, FamilyDef> = {
  display: { key: 'display', label: 'Display Build', engine: 'timestudy', form: 'sidekick', channel: 'retail_mass', uom: 'per unit', lines: ['palletsOut', 'inbound', 'labelQty', 'storagePallets'], setup: true },
  copack: { key: 'copack', label: 'Co-Pack / Repack', engine: 'timestudy', form: 'shipper_case', channel: 'grocery', uom: 'per unit', lines: ['inbound', 'palletsOut', 'labelQty', 'storagePallets'], setup: true },
  kitting: { key: 'kitting', label: 'Kitting & Assembly', engine: 'touch', form: 'kit_box', channel: 'retail_club', uom: 'per touch', lines: ['palletsOut', 'labelQty'], setup: true },
  fulfillment: { key: 'fulfillment', label: 'Fulfillment / E-Comm', engine: 'menu', form: 'individual', channel: 'dtc', uom: 'per order', lines: ['ecomOrders', 'ecomPieces', 'labelQty'], setup: true },
  warehousing: { key: 'warehousing', label: 'Warehousing / 3PL', engine: 'menu', form: 'pallet_display', channel: 'b2b', uom: 'per pallet', lines: ['inbound', 'storagePallets'], setup: false },
  valueadd: { key: 'valueadd', label: 'Value-Add Processing', engine: 'perpiece', form: 'individual', channel: 'dtc', uom: 'per piece', lines: ['labelQty'], setup: false },
  admin: { key: 'admin', label: 'Administration', engine: 'flat', form: 'na', channel: 'na', uom: 'per account', lines: ['programmingHrs', 'shopHours'], setup: true },
  // Manufacturing pillar (ADR 0006 P3): a family per engine kind, mirroring the
  // breadth 3PL has, all config-only (existing engines + existing line keys).
  mfg_production: { key: 'mfg_production', label: 'Manufacturing / Production Run', engine: 'timestudy', form: 'production', channel: 'b2b', uom: 'per unit', lines: ['shopHours', 'labelQty', 'storagePallets'], setup: true },
  mfg_assembly: { key: 'mfg_assembly', label: 'Manufacturing / Assembly', engine: 'touch', form: 'assembly', channel: 'b2b', uom: 'per touch', lines: ['labelQty'], setup: true },
  mfg_machining: { key: 'mfg_machining', label: 'Manufacturing / Machining', engine: 'perpiece', form: 'machined', channel: 'b2b', uom: 'per piece', lines: ['labelQty'], setup: false },
  mfg_finishing: { key: 'mfg_finishing', label: 'Manufacturing / Finishing', engine: 'menu', form: 'finished', channel: 'b2b', uom: 'per unit', lines: ['labelQty', 'storagePallets'], setup: true },
  mfg_shop: { key: 'mfg_shop', label: 'Manufacturing / Shop Time', engine: 'flat', form: 'na', channel: 'na', uom: 'per hour', lines: ['shopHours', 'programmingHrs'], setup: true },
};

export const ENGINE_LABELS: Record<EngineKind, string> = {
  timestudy: 'Time-study',
  touch: 'Touch-based',
  perpiece: 'Per-piece',
  menu: 'Menu',
  flat: 'Flat / hourly',
};
