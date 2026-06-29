// Facet vocabularies (labels + option lists) shared by the wizard steps and the
// live summary so labels never drift between screens.

import {
  ENGINE_LABELS,
  FAMILIES,
  type EngineKind,
  type FamilyKey,
  type InboundMode,
} from '@/lib/estimate/families';
import type { MaterialsMode } from './engineState';

export const FORM_LABELS: Record<string, string> = {
  sidekick: 'Sidekick',
  power_wing: 'Power wing',
  floorstand: 'Floor stand',
  pdq: 'PDQ',
  pallet_display: 'Pallet display',
  half_pallet: 'Half-pallet',
  shipper_case: 'Shipper case',
  kit_box: 'Kit / box',
  individual: 'Individual unit',
  // Manufacturing pillar forms (ADR 0006 P3).
  production: 'Production run',
  assembly: 'Assembly',
  machined: 'Machined part',
  finished: 'Finished good',
  na: '-',
};

export const CHANNEL_LABELS: Record<string, string> = {
  retail_mass: 'Retail-Mass',
  retail_club: 'Retail-Club',
  grocery: 'Grocery',
  cstore: 'C-Store',
  dtc: 'DTC / E-Comm',
  b2b: 'B2B / Wholesale',
  event: 'Event / Sampling',
  na: '-',
};

export const MATERIALS_LABELS: Record<MaterialsMode, string> = {
  customer: 'Customer-supplied',
  sourced: 'Sourced / pass-through',
};

export const INBOUND_MODE_LABELS: Record<InboundMode, string> = {
  pallet: 'Pallet',
  case: 'Case under 40 lb',
  case_heavy: 'Case over 40 lb',
};

function toOptions(labels: Record<string, string>, keys: string[]) {
  return keys.map((value) => ({ value, label: labels[value] ?? value }));
}

export const FAMILY_OPTIONS = (Object.keys(FAMILIES) as FamilyKey[]).map((value) => ({
  value,
  label: FAMILIES[value].label,
}));

export const FORM_OPTIONS = toOptions(FORM_LABELS, [
  'sidekick', 'power_wing', 'floorstand', 'pdq', 'pallet_display',
  'half_pallet', 'shipper_case', 'kit_box', 'individual',
  'production', 'assembly', 'machined', 'finished',
]);

export const CHANNEL_OPTIONS = toOptions(CHANNEL_LABELS, [
  'retail_mass', 'retail_club', 'grocery', 'cstore', 'dtc', 'b2b', 'event',
]);

export const ENGINE_OPTIONS = (Object.keys(ENGINE_LABELS) as EngineKind[]).map((value) => ({
  value,
  label: ENGINE_LABELS[value],
}));

export const MATERIALS_OPTIONS: { value: MaterialsMode; label: string }[] = [
  { value: 'customer', label: 'Customer-supplied' },
  { value: 'sourced', label: 'Sourced / pass-through' },
];

export const INBOUND_MODE_OPTIONS: { value: InboundMode; label: string }[] = [
  { value: 'pallet', label: 'Pallet' },
  { value: 'case', label: 'Case under 40 lb' },
  { value: 'case_heavy', label: 'Case over 40 lb' },
];
