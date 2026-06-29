import { describe, expect, it } from 'vitest';

import * as spa from '@/lib/estimate/engine';
import { DEFAULT_RATE_CARD } from '@/lib/estimate/rateCard';
import * as shared from '../../../../supabase/functions/_shared/estimate/engine';

// Behaviour parity for the Estimate Engine pricing core. engine.ts cannot be
// byte-paired (the Deno copy needs .ts import extensions and resolves money one
// directory up), so the byte-parity test covers families.ts / rateCard.ts and
// this suite proves the two engine.ts copies compute byte-for-byte identical
// cents across every engine type, the $500 project minimum, and the 2.5x margin
// floor. Drift in the pricing math here is a money-rule release blocker.

type Input = spa.EstimateInput;

// A complete, zeroed EstimateInput; each case overrides only what it exercises.
function base(over: Partial<Input>): Input {
  return {
    family: 'display',
    engine: 'timestudy',
    qty: 0,
    studyMin: 0,
    studySec: 0,
    inflationPct: 0,
    markup: 0,
    touches: 0,
    baseRateMicros: 0,
    inboundPallets: 0,
    inboundMode: 'pallet',
    palletsOut: 0,
    palletGrade: 'a',
    labelQty: 0,
    storagePallets: 0,
    storageMonths: 0,
    ecomOrders: 0,
    ecomPieces: 0,
    programmingHrs: 0,
    shopHours: 0,
    machineHours: 0,
    rawMaterialUnits: 0,
    materialsSourced: false,
    setupOn: false,
    ...over,
  };
}

const CASES: ReadonlyArray<{ name: string; input: Input }> = [
  {
    name: 'time-study display with rate-card pass-through and setup',
    input: base({
      family: 'display', engine: 'timestudy',
      qty: 1200, studyMin: 0, studySec: 18, inflationPct: 12, markup: 2.8,
      inboundPallets: 4, inboundMode: 'pallet', palletsOut: 6, palletGrade: 'a',
      labelQty: 1200, storagePallets: 120, storageMonths: 3, setupOn: true,
    }),
  },
  {
    name: 'touch kitting',
    input: base({
      family: 'kitting', engine: 'touch',
      qty: 5000, touches: 3, palletsOut: 10, palletGrade: 'b', labelQty: 5000,
      setupOn: true,
    }),
  },
  {
    name: 'per-piece value-add (sub-cent base rate in micros)',
    input: base({
      family: 'valueadd', engine: 'perpiece',
      qty: 9000, baseRateMicros: 18_060, labelQty: 9000,
    }),
  },
  {
    name: 'menu fulfillment (no production engine)',
    input: base({
      family: 'fulfillment', engine: 'menu',
      ecomOrders: 800, ecomPieces: 2400, labelQty: 800,
    }),
  },
  {
    name: 'flat admin (programming + shop hours)',
    input: base({
      family: 'admin', engine: 'flat',
      programmingHrs: 12, shopHours: 6, setupOn: true,
    }),
  },
  {
    name: 'warehousing menu (inbound + storage tiers)',
    input: base({
      family: 'warehousing', engine: 'menu',
      inboundPallets: 30, inboundMode: 'case', storagePallets: 600, storageMonths: 2,
    }),
  },
  {
    name: 'tiny job under the $500 project minimum (minApplied)',
    input: base({
      family: 'valueadd', engine: 'perpiece', qty: 50, baseRateMicros: 100_000,
    }),
  },
  {
    name: 'time-study below the 2.5x margin floor (marginOk false)',
    input: base({
      family: 'display', engine: 'timestudy',
      qty: 1000, studyMin: 0, studySec: 20, inflationPct: 0, markup: 1.5,
    }),
  },
  {
    name: 'manufacturing production with machine time + sourced raw materials',
    input: base({
      family: 'mfg_production', engine: 'timestudy',
      qty: 2000, studySec: 30, inflationPct: 20, markup: 2.5,
      machineHours: 16, rawMaterialUnits: 2000, materialsSourced: true,
      shopHours: 8, labelQty: 2000, storagePallets: 40, storageMonths: 1, setupOn: true,
    }),
  },
  {
    name: 'manufacturing machining with customer-supplied materials (no raw line)',
    input: base({
      family: 'mfg_machining', engine: 'perpiece',
      qty: 4000, baseRateMicros: 42_000,
      machineHours: 24, rawMaterialUnits: 4000, materialsSourced: false, labelQty: 4000,
    }),
  },
];

describe('estimate engine behaviour parity (SPA vs _shared)', () => {
  for (const c of CASES) {
    it(`${c.name}: computeEstimate matches byte-for-byte`, () => {
      const a = spa.computeEstimate(c.input, DEFAULT_RATE_CARD);
      const b = shared.computeEstimate(c.input, DEFAULT_RATE_CARD);
      expect(a).toEqual(b);
    });
  }

  it('shared constants match the SPA', () => {
    expect(shared.MIN_PROJECT_CENTS).toBe(spa.MIN_PROJECT_CENTS);
    expect(shared.MARGIN_FLOOR).toBe(spa.MARGIN_FLOOR);
  });
});
