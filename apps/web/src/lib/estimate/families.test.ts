// The Manufacturing pillar families (ADR 0006 P3) are added through the config
// seam alone: each reuses an existing engine and the existing line vocabulary,
// so the pricing core (engine.ts) stays untouched. This locks that contract.

import { describe, it, expect } from 'vitest';

import { FAMILIES, type FamilyKey, type EngineKind, type LineKey } from './families';

const MFG_KEYS: FamilyKey[] = [
  'mfg_production', 'mfg_assembly', 'mfg_machining', 'mfg_finishing', 'mfg_shop',
];

// The engines and line keys the pricing engine handles. The two manufacturing
// primitives (machineHours, rawMaterials) were added to the pricing core in the
// P3 follow-on; every other line predates the Manufacturing pillar.
const KNOWN_ENGINES: EngineKind[] = ['timestudy', 'touch', 'perpiece', 'menu', 'flat'];
const KNOWN_LINES: LineKey[] = [
  'inbound', 'palletsOut', 'labelQty', 'storagePallets',
  'ecomOrders', 'ecomPieces', 'programmingHrs', 'shopHours',
  'machineHours', 'rawMaterials',
];

describe('Manufacturing families', () => {
  it('adds a manufacturing family for each engine kind (the breadth 3PL has)', () => {
    const engines = new Set(MFG_KEYS.map((k) => FAMILIES[k].engine));
    expect(engines).toEqual(new Set(KNOWN_ENGINES));
  });

  it('reuses only existing engines (no new pricing engine)', () => {
    for (const k of MFG_KEYS) {
      expect(KNOWN_ENGINES).toContain(FAMILIES[k].engine);
    }
  });

  it('uses only line keys the pricing engine handles', () => {
    for (const k of MFG_KEYS) {
      for (const line of FAMILIES[k].lines) {
        expect(KNOWN_LINES).toContain(line);
      }
    }
  });

  it('labels every manufacturing family under the Manufacturing pillar', () => {
    for (const k of MFG_KEYS) {
      expect(FAMILIES[k].label).toMatch(/^Manufacturing/);
    }
  });
});
