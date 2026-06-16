// R-W13-UX-02: pure helpers for staging BOM component drafts on the
// create screen. A BOM has no single "create" endpoint: each component
// is its own bom_item row created over createBomItem. Previously the
// create page captured exactly one component then sent the operator to
// the detail page to add the rest. This module lets the create page
// stage several components in memory and replay each one through
// createBomItem after the operator picks the finished item, in a single
// submit flow (one user action).
//
// Split out as a pure module (no React, no query hooks, no supabase
// client in the graph) so the vitest suite can pin the contract, the
// same pattern as `lineDraft.ts` and `applyItemSelection.ts`.

import type { BomItem } from '@/lib/types/vendors_inventory_ops';

/**
 * In-memory draft for a BOM component on the create form. Mirrors the
 * BomDetailPage add-component field set (component item, quantity per,
 * unit of measure, notes). quantity_per is held as a string so the
 * input stays fully controlled.
 */
export interface BomLineDraft {
  /** Stable client-side React key. Not sent to the server. */
  draftId: string;
  component_item_id: string;
  /** Decimal quantity per parent as a string ("1", "2.5"). */
  quantity_per: string;
  unit_of_measure: string;
  notes: string;
}

let fallbackCounter = 0;

/**
 * Stable-ish draft id. `crypto.randomUUID` is the constitutional choice
 * (the `uuid` package is banned). Falls back to a counter when the
 * runtime lacks it.
 */
export function nextBomDraftId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  fallbackCounter += 1;
  return `bom-line-draft-${fallbackCounter}`;
}

export function makeEmptyBomLineDraft(): BomLineDraft {
  return {
    draftId: nextBomDraftId(),
    component_item_id: '',
    quantity_per: '1',
    unit_of_measure: '',
    notes: '',
  };
}

/**
 * True when a draft carries a component selection. Blank rows (no
 * component picked) are dropped before submit.
 */
export function isBomLineDraftFilled(draft: BomLineDraft): boolean {
  return draft.component_item_id.trim().length > 0;
}

/** Validation outcome for the staged drafts against a chosen parent. */
export interface BomDraftValidation {
  ok: boolean;
  /** Operator-facing message when ok is false. */
  message: string | null;
}

/**
 * Validate the staged drafts against the chosen finished (parent) item.
 * Catches the two cases the per-row form cannot: a component equal to
 * the parent, and a positive-quantity rule. At least one filled line is
 * required so the operator does not create a BOM with no components.
 * Mirrors the BomCreatePage / BomDetailPage rules.
 */
export function validateBomDrafts(
  parentItemId: string,
  drafts: BomLineDraft[],
): BomDraftValidation {
  const filled = drafts.filter(isBomLineDraftFilled);
  if (filled.length === 0) {
    return { ok: false, message: 'Add at least one component.' };
  }
  for (const draft of filled) {
    if (draft.component_item_id === parentItemId) {
      return {
        ok: false,
        message: 'A component cannot be the finished item itself.',
      };
    }
    const qty = Number(draft.quantity_per);
    if (!Number.isFinite(qty) || qty <= 0) {
      return { ok: false, message: 'Quantity per must be greater than zero.' };
    }
  }
  return { ok: true, message: null };
}

/**
 * Convert one draft into the createBomItem body. The parent item id is
 * supplied by the caller (chosen once for the whole BOM). Pure; testable
 * without a React renderer.
 */
export function bomDraftToCreateBody(
  parentItemId: string,
  draft: BomLineDraft,
): Partial<BomItem> {
  return {
    parent_item_id: parentItemId,
    component_item_id: draft.component_item_id,
    quantity_per: Number(draft.quantity_per),
    unit_of_measure: draft.unit_of_measure ? draft.unit_of_measure : null,
    notes: draft.notes ? draft.notes : null,
  };
}

/**
 * Convert the filled drafts (skipping blank rows) into ordered
 * createBomItem bodies for the chosen parent. Entry order is preserved.
 */
export function bomDraftsToCreateBodies(
  parentItemId: string,
  drafts: BomLineDraft[],
): Partial<BomItem>[] {
  return drafts
    .filter(isBomLineDraftFilled)
    .map((draft) => bomDraftToCreateBody(parentItemId, draft));
}
