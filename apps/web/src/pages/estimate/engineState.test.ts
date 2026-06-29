import { describe, it, expect } from 'vitest';

import {
  initialState,
  reducer,
  toEstimateInput,
  toEstimateInputs,
  toEngineCard,
  fromEstimate,
} from './engineState';
import type { Estimate, RateCardLine } from '@/lib/types/estimate';

describe('engineState', () => {
  it('choosing a family preloads its engine, facets, and default line set', () => {
    const next = reducer(initialState(), { type: 'family', family: 'kitting' });
    expect(next.family).toBe('kitting');
    expect(next.engine).toBe('touch'); // kitting -> touch engine
    expect(next.setupOn).toBe(true);
    // kitting's default lines (palletsOut, labelQty) are pre-filled > 0
    expect(Number(next.palletsOut)).toBeGreaterThan(0);
    expect(Number(next.labelQty)).toBeGreaterThan(0);
  });

  it('toEstimateInput converts the per-piece base rate from dollars to micros', () => {
    const state = { ...initialState(), baseRate: '0.25' };
    const input = toEstimateInput(state);
    expect(input.baseRateMicros).toBe(250_000); // $0.25 = 250,000 micros
  });

  it('toEstimateInput clamps negatives and non-numbers to 0', () => {
    const state = { ...initialState(), qty: '-5', studySec: 'abc', baseRate: '-1' };
    const input = toEstimateInput(state);
    expect(input.qty).toBe(0);
    expect(input.studySec).toBe(0);
    expect(input.baseRateMicros).toBe(0);
  });

  it('toEstimateInputs carries every engine field but never family/engine', () => {
    const inputs = toEstimateInputs(initialState());
    expect(inputs).not.toHaveProperty('family');
    expect(inputs).not.toHaveProperty('engine');
    expect(inputs).toHaveProperty('qty');
    expect(inputs).toHaveProperty('setupOn');
    expect(inputs).toHaveProperty('inboundMode');
  });

  it('toEngineCard maps the wire shape (group_key, rate_micros) to the engine shape', () => {
    const wire: RateCardLine[] = [
      {
        id: 'l1', org_id: 'o1', rate_card_id: 'c1',
        code: 'CON-LABOR', group_key: 'constants', label: 'Labor',
        rate_micros: '25000000', uom: 'hr', position: 0,
      },
    ];
    const card = toEngineCard(wire);
    expect(card).toEqual([
      { code: 'CON-LABOR', group: 'constants', label: 'Labor', rateMicros: 25_000_000 },
    ]);
  });

  it('fromEstimate round-trips inputs back through the wizard state', () => {
    const est: Estimate = {
      id: 'e1', org_id: 'o1', number: null, name: 'Acme display',
      customer_id: 'cust1', rate_card_id: 'card1',
      family: 'display', engine: 'timestudy', currency_code: 'USD', status: 'draft',
      inputs: {
        qty: 1200, studyMin: 0, studySec: 18, inflationPct: 30, markup: 3,
        touches: 0, baseRateMicros: 250_000,
        inboundPallets: 4, inboundMode: 'pallet', palletsOut: 6, palletGrade: 'a',
        labelQty: 1200, storagePallets: 50, storageMonths: 2,
        ecomOrders: 0, ecomPieces: 0, programmingHrs: 0, shopHours: 0,
        machineHours: 0, rawMaterialUnits: 0, materialsSourced: false, setupOn: true,
      },
      subtotal_cents: 0, total_cents: 0, min_applied: false,
      converted_to_quote_id: null, converted_at: null, cancelled_at: null, notes: null,
    };
    const state = fromEstimate(est);
    expect(state.projectName).toBe('Acme display');
    expect(state.customerId).toBe('cust1');
    expect(state.family).toBe('display');
    expect(state.baseRate).toBe('0.25');
    // the inputs assembled from the seeded state match the original numbers
    const inputs = toEstimateInputs(state);
    expect(inputs.qty).toBe(1200);
    expect(inputs.palletsOut).toBe(6);
    expect(inputs.baseRateMicros).toBe(250_000);
    expect(inputs.setupOn).toBe(true);
    expect(inputs.inboundMode).toBe('pallet');
  });
});
