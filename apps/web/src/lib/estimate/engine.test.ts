import { describe, it, expect } from 'vitest';

import { computeEstimate, MIN_PROJECT_CENTS, type EstimateInput } from './engine';
import { DEFAULT_RATE_CARD, rateMicrosOf } from './rateCard';
import { FAMILIES } from './families';

// A baseline input with everything zeroed; each test overrides only what it
// needs so the assertions read against a single known starting point. Monetary
// inputs are micros (millionths of a currency unit), per the cents money model.
function baseInput(overrides: Partial<EstimateInput> = {}): EstimateInput {
  return {
    family: 'display',
    engine: 'timestudy',
    qty: 0,
    studyMin: 0,
    studySec: 0,
    inflationPct: 30,
    markup: 3,
    touches: 0,
    baseRateMicros: 0,
    inboundPallets: 0,
    inboundMode: 'pallet',
    palletsOut: 0,
    palletGrade: 'b',
    labelQty: 0,
    storagePallets: 0,
    storageMonths: 1,
    ecomOrders: 0,
    ecomPieces: 0,
    programmingHrs: 0,
    shopHours: 0,
    setupOn: false,
    ...overrides,
  };
}

const card = DEFAULT_RATE_CARD;

describe('rateMicrosOf', () => {
  it('looks up a known rate (micros) by code', () => {
    expect(rateMicrosOf(card, 'CON-LABOR')).toBe(25_000_000);
    expect(rateMicrosOf(card, 'CON-TOUCH')).toBe(100_000);
  });

  it('prices an unknown code at 0 rather than throwing', () => {
    expect(rateMicrosOf(card, 'NOPE')).toBe(0);
  });
});

describe('time-study engine (sidekick)', () => {
  // Raw 20s, inflate x1.30 -> 26s, qty 1131. COL/unit ~ $0.1806, sell x3 ~ $0.5417.
  const result = computeEstimate(baseInput({ qty: 1131, studySec: 20, inflationPct: 30, markup: 3 }), card);

  it('computes labor cost per unit (micros) from the inflated study', () => {
    expect(result.colPerUnitMicros).toBeCloseTo(180_555.56, 1);
  });

  it('sells at the markup multiple of labor cost', () => {
    expect(result.sellPerUnitMicros).toBeCloseTo(541_666.67, 1);
  });

  it('rolls the production line up to sell x qty (cents)', () => {
    // Exact mathematical total is $612.625 = 61262.5 cents, a banker's boundary;
    // allow a 5-cent tolerance for the sub-cent float intermediate.
    expect(result.productionCents).toBeCloseTo(61_262, -1);
  });

  it('clears the 2.5x labor floor at 3x markup', () => {
    expect(result.marginOk).toBe(true);
  });

  it('fails the labor floor below 2.5x markup', () => {
    const tight = computeEstimate(baseInput({ qty: 1131, studySec: 20, markup: 2 }), card);
    expect(tight.marginOk).toBe(false);
  });
});

describe('touch engine (club sampling kit)', () => {
  // 36 touches x $0.10 = $3.60/kit, qty 1000 -> $3,600.00 = 360000 cents.
  const result = computeEstimate(baseInput({ family: 'kitting', engine: 'touch', qty: 1000, touches: 36 }), card);

  it('sells each unit at touches x touch rate', () => {
    expect(result.sellPerUnitMicros).toBe(3_600_000);
  });

  it('rolls the kitting line up to $3,600 (360000 cents)', () => {
    expect(result.productionCents).toBe(360_000);
  });
});

describe('per-piece engine (barcode/relabel)', () => {
  // 5,000 pieces x $0.25 = $1,250.00 = 125000 cents.
  const result = computeEstimate(baseInput({ family: 'valueadd', engine: 'perpiece', qty: 5000, baseRateMicros: 250_000 }), card);

  it('uses the base rate (micros) as sell per piece', () => {
    expect(result.sellPerUnitMicros).toBe(250_000);
    expect(result.productionCents).toBe(125_000);
  });
});

describe('menu engine (warehousing/3PL)', () => {
  // Receive 60 pallets ($5.50) + 60 pallets storage 1 mo (1-99 tier $16).
  const result = computeEstimate(
    baseInput({ family: 'warehousing', engine: 'menu', inboundPallets: 60, storagePallets: 60, storageMonths: 1 }),
    card,
  );

  it('has no production line for a menu family', () => {
    expect(result.hasProduction).toBe(false);
    expect(result.productionCents).toBe(0);
  });

  it('prices receiving + storage from the rate card', () => {
    // 60 x $5.50 + 60 x 1 x $16.00 = $330 + $960 = $1,290.00 = 129000 cents.
    expect(result.passThroughCents).toBe(129_000);
  });

  it('selects the 100-499 storage tier above 100 pallets', () => {
    const tiered = computeEstimate(
      baseInput({ family: 'warehousing', engine: 'menu', storagePallets: 120, storageMonths: 1 }),
      card,
    );
    // 120 x $13.50 = $1,620.00 = 162000 cents.
    expect(tiered.passThroughCents).toBe(162_000);
  });
});

describe('pallet line expands into pallet + wrap', () => {
  const result = computeEstimate(baseInput({ family: 'display', qty: 1, studySec: 1, palletsOut: 40, palletGrade: 'b' }), card);

  it('emits a Grade-B pallet line and a wrap line', () => {
    const labels = result.passThroughItems.map((i) => i.label);
    expect(labels).toContain('Shipping pallets (Grade B)');
    expect(labels).toContain('Pallet wrap & processing');
    // 40 x $13.00 + 40 x $5.00 = $720.00 = 72000 cents.
    const pallets = result.passThroughItems.filter((i) => i.label.startsWith('Shipping pallets') || i.label.startsWith('Pallet wrap'));
    expect(pallets.reduce((a, b) => a + b.amountCents, 0)).toBe(72_000);
  });
});

describe('$500 project minimum', () => {
  it('floors a tiny job to $500 and flags it', () => {
    // 20-unit touch kit: 20 x 36 x $0.10 = $72 -> floored to $500.
    const result = computeEstimate(baseInput({ family: 'kitting', engine: 'touch', qty: 20, touches: 36 }), card);
    expect(result.rawCents).toBe(7_200);
    expect(result.minApplied).toBe(true);
    expect(result.totalCents).toBe(MIN_PROJECT_CENTS);
  });

  it('does not floor a job already above the minimum', () => {
    const result = computeEstimate(baseInput({ family: 'kitting', engine: 'touch', qty: 1000, touches: 36 }), card);
    expect(result.minApplied).toBe(false);
    expect(result.totalCents).toBe(360_000);
  });

  it('leaves an empty estimate at $0 (minimum applies only to real work)', () => {
    const result = computeEstimate(baseInput(), card);
    expect(result.rawCents).toBe(0);
    expect(result.minApplied).toBe(false);
    expect(result.totalCents).toBe(0);
  });
});

describe('new account setup', () => {
  it('adds the setup fee when the family supports it and it is toggled on', () => {
    const on = computeEstimate(baseInput({ family: 'display', qty: 1, studySec: 1, setupOn: true }), card);
    expect(on.passThroughItems.some((i) => i.label === 'New account setup')).toBe(true);
  });

  it('omits setup for families that do not support it', () => {
    expect(FAMILIES.warehousing.setup).toBe(false);
    const off = computeEstimate(baseInput({ family: 'warehousing', engine: 'menu', inboundPallets: 10, setupOn: true }), card);
    expect(off.passThroughItems.some((i) => i.label === 'New account setup')).toBe(false);
  });
});

describe('rate card is the source of truth', () => {
  it('recomputes when a rate changes', () => {
    const bumped = card.map((c) => (c.code === 'CON-TOUCH' ? { ...c, rateMicros: 200_000 } : c));
    const result = computeEstimate(baseInput({ family: 'kitting', engine: 'touch', qty: 1000, touches: 36 }), bumped);
    // 36 x $0.20 x 1000 = $7,200.00 = 720000 cents.
    expect(result.productionCents).toBe(720_000);
  });
});
