// Pure helpers and types for the LineItemsEditor create-form flow.
// Split out from `LineItemsEditor.tsx` so the test suite can import
// these without dragging React, the query hooks, or the Supabase client
// into the module graph (the repo has no jsdom or testing-library
// dependency — see `featureFlagResolver.test.ts` for the pattern).
//
// Backs PR-5 / bug B3 from the 2026-05-21 E2E smoke walk: the receiving
// and shipment NEW forms must submit a STRUCTURED array of line drafts
// (not a JSON string) to the line-item POST endpoints, matching the
// `ReceivingOrderLineItemCreate` / `ShipmentLineItemCreate` Zod schemas
// in `apps/web/src/lib/types/vendors_inventory_ops.ts`.

export interface LineDraft {
  /** Stable client-side id used as React key. Not sent to the server. */
  draftId: string;
  item_id: string;
  /** Stored as a string so the input is fully controlled; the parent parses. */
  quantity: string;
  /** Whole cents as a string; empty string means null. */
  unit_cost_cents: string;
  uom: string;
  reference: string;
}

/**
 * Shape submitted to the line-item POST endpoint. Matches
 * `ReceivingOrderLineItemCreate` / `ShipmentLineItemCreate` field-for-field.
 */
export interface LinePostBody {
  item_id: string;
  quantity: string;
  unit_cost_cents: number | null;
  uom: string | null;
  reference: string | null;
}

let fallbackCounter = 0;

/**
 * Stable-ish draft id generator. `crypto.randomUUID` is the constitutional
 * choice (the `uuid` package is banned). Falls back to a counter for the
 * rare case the runtime lacks it (older test harnesses).
 */
export function nextDraftId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  fallbackCounter += 1;
  return `draft-${fallbackCounter}`;
}

export function makeEmptyDraft(): Omit<LineDraft, 'draftId'> {
  return {
    item_id: '',
    quantity: '1',
    unit_cost_cents: '',
    uom: '',
    reference: '',
  };
}

/**
 * Convert a draft into the POST body the line-item endpoint expects.
 * Pure — testable without a React renderer.
 */
export function draftToPostBody(draft: LineDraft): LinePostBody {
  return {
    item_id: draft.item_id,
    quantity: draft.quantity,
    unit_cost_cents:
      draft.unit_cost_cents === '' ? null : Number(draft.unit_cost_cents),
    uom: draft.uom === '' ? null : draft.uom,
    reference: draft.reference === '' ? null : draft.reference,
  };
}

/**
 * Convert an array of drafts. Order is preserved so the server-side
 * `position` defaults match the operator's entry order.
 */
export function draftsToPostBodies(drafts: LineDraft[]): LinePostBody[] {
  return drafts.map(draftToPostBody);
}
