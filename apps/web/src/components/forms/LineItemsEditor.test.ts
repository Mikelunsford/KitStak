// Regression coverage for PR-5 / bug B3 from the 2026-05-21 E2E smoke walk.
// Confirms the LineItemsEditor's pure orchestration helpers (`draftToPostBody`
// and `draftsToPostBodies`) produce a STRUCTURED ARRAY suitable for direct
// POST to `/receiving-orders/:id/line-items` and `/shipments/:id/line-items`.
//
// The component itself is a thin React wrapper; the repo has no jsdom or
// testing-library dependency (see featureFlagResolver.test.ts), so behaviour
// is exercised through the exported pure helpers that the create-page submit
// flow drives.
//
// Constitutional invariant under test: the create form must submit a real
// structured object (not a JSON string), matching the
// `ReceivingOrderLineItemCreate` / `ShipmentLineItemCreate` Zod schemas.

import { describe, it, expect } from 'vitest';

import {
  draftToPostBody,
  draftsToPostBodies,
  makeEmptyDraft,
  type LineDraft,
} from './lineDraft';

const sampleDraft = (overrides: Partial<LineDraft> = {}): LineDraft => ({
  draftId: 'draft-1',
  item_id: '00000000-0000-4000-8000-0000000000aa',
  quantity: '12',
  unit_cost_cents: '250',
  uom: 'EA',
  reference: 'PO-123',
  ...overrides,
});

describe('LineItemsEditor / draftToPostBody (receiving create flow)', () => {
  it('returns a structured object — not a JSON string', () => {
    const out = draftToPostBody(sampleDraft());
    expect(typeof out).toBe('object');
    expect(out).not.toBeNull();
    // Critical regression: the textarea-era code path produced a JSON-stringified
    // body. This must be a real object so apiRequest serialises it once.
    expect(typeof out).not.toBe('string');
  });

  it('carries item_id and quantity verbatim', () => {
    const out = draftToPostBody(sampleDraft());
    expect(out.item_id).toBe('00000000-0000-4000-8000-0000000000aa');
    expect(out.quantity).toBe('12');
  });

  it('converts a numeric unit_cost_cents string to a number', () => {
    const out = draftToPostBody(sampleDraft({ unit_cost_cents: '250' }));
    expect(out.unit_cost_cents).toBe(250);
  });

  it('maps empty unit_cost_cents to null (shipment-mode parity)', () => {
    const out = draftToPostBody(sampleDraft({ unit_cost_cents: '' }));
    expect(out.unit_cost_cents).toBeNull();
  });

  it('maps empty uom to null', () => {
    const out = draftToPostBody(sampleDraft({ uom: '' }));
    expect(out.uom).toBeNull();
  });

  it('maps empty reference to null', () => {
    const out = draftToPostBody(sampleDraft({ reference: '' }));
    expect(out.reference).toBeNull();
  });
});

describe('LineItemsEditor / draftsToPostBodies (batched submit)', () => {
  it('returns an Array (not a JSON string) of structured bodies', () => {
    const drafts = [
      sampleDraft({ draftId: 'a' }),
      sampleDraft({ draftId: 'b', item_id: '00000000-0000-4000-8000-0000000000bb' }),
    ];
    const out = draftsToPostBodies(drafts);
    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(2);
    expect(out[0]?.item_id).toBe('00000000-0000-4000-8000-0000000000aa');
    expect(out[1]?.item_id).toBe('00000000-0000-4000-8000-0000000000bb');
  });

  it('preserves operator entry order so server position defaults align', () => {
    const drafts = [
      sampleDraft({ draftId: 'first', item_id: '00000000-0000-4000-8000-000000000001' }),
      sampleDraft({ draftId: 'second', item_id: '00000000-0000-4000-8000-000000000002' }),
      sampleDraft({ draftId: 'third', item_id: '00000000-0000-4000-8000-000000000003' }),
    ];
    const out = draftsToPostBodies(drafts);
    expect(out.map((b) => b.item_id)).toEqual([
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
      '00000000-0000-4000-8000-000000000003',
    ]);
  });

  it('returns an empty array when no lines were staged', () => {
    expect(draftsToPostBodies([])).toEqual([]);
  });
});

describe('LineItemsEditor / makeEmptyDraft', () => {
  it('seeds quantity to "1" and clears the rest', () => {
    const empty = makeEmptyDraft();
    expect(empty.quantity).toBe('1');
    expect(empty.item_id).toBe('');
    expect(empty.unit_cost_cents).toBe('');
    expect(empty.uom).toBe('');
    expect(empty.reference).toBe('');
  });
});

describe('LineItemsEditor / receiving-mode submit shape', () => {
  it('a receiving draft round-trips into ReceivingOrderLineItemCreate shape', () => {
    const out = draftToPostBody(
      sampleDraft({
        item_id: '00000000-0000-4000-8000-0000000000aa',
        quantity: '50',
        unit_cost_cents: '425',
        uom: 'EA',
        reference: 'PO-456',
      }),
    );
    // Matches `ReceivingOrderLineItemCreateSchema` field names exactly.
    expect(out).toEqual({
      item_id: '00000000-0000-4000-8000-0000000000aa',
      quantity: '50',
      unit_cost_cents: 425,
      uom: 'EA',
      reference: 'PO-456',
    });
  });
});

describe('LineItemsEditor / shipment-mode submit shape', () => {
  it('a shipment draft (no unit cost) round-trips into ShipmentLineItemCreate shape', () => {
    const out = draftToPostBody(
      sampleDraft({
        item_id: '00000000-0000-4000-8000-0000000000bb',
        quantity: '3',
        unit_cost_cents: '',
        uom: 'CS',
        reference: '',
      }),
    );
    expect(out).toEqual({
      item_id: '00000000-0000-4000-8000-0000000000bb',
      quantity: '3',
      unit_cost_cents: null,
      uom: 'CS',
      reference: null,
    });
  });
});
