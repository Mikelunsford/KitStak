// B1 (Wave B): pure helpers that convert a source-document line
// (shipment_line_items or project_line_items) into the InvoiceLineCreate
// payload accepted by /invoicing-api/invoices/:id/line-items.
//
// Why this exists: when the operator deep-links to InvoiceCreatePage with
// ?shipment_id= or ?project_id= we want a ready-to-send invoice with
// realistic lines, not an empty shell. Two stages mirror the pattern set
// by ShipmentCreatePage (PR #104 / B3): the header create POST runs
// first, then each pre-derived line POSTs sequentially. Operator can
// still edit/remove lines on the detail page after create.
//
// Pure functions only. No React, no fetch, no zod parsing. Testable in
// isolation via vitest.

import type { Item, ProjectLineItem } from '@/lib/types/sales';
import type { ShipmentLineItem } from '@/lib/types/vendors_inventory_ops';
import type { InvoiceLineCreate } from '@/lib/services/invoiceLineItemsService';
import { roundHalfEven } from '@/lib/money';

/**
 * Lookup a string field off an Item by id, used to derive the
 * description and unit_price_cents on the invoice line. Returns null
 * when the item is not in the loaded list yet (the caller can skip the
 * conversion or fall back to a safe default).
 */
function findItem(
  items: ReadonlyArray<Item> | undefined,
  itemId: string,
): Item | null {
  if (!items) return null;
  const match = items.find((i) => i.id === itemId);
  return match ?? null;
}

/**
 * Convert a single shipment_line_items row into an InvoiceLineCreate
 * body. Returns null when the item lookup fails (deferred to the caller
 * to either drop the line or fall back).
 *
 * Field mapping:
 *   - description     <- item.name (shipment lines do not snapshot a description)
 *   - quantity        <- shipment line quantity (string)
 *   - unit_price_cents <- item.unit_price_cents (the SALES price, not the
 *                         shipment's unit_cost_cents, which is the COGS
 *                         snapshot for inventory accounting)
 *   - line_total_cents <- roundHalfEven(qty * price) using banker's rounding.
 *                         This is a client-side prefill only; the invoicing
 *                         handler now server-recomputes line totals (A1), so
 *                         the prefill value is a display convenience and the
 *                         server is the authority on persisted totals.
 *   - item_id         <- preserved so downstream reporting joins back
 *   - sort_order      <- shipment line position (1-based on the form)
 */
export function shipmentLineToInvoiceLineCreate(
  shipmentLine: Pick<
    ShipmentLineItem,
    'item_id' | 'quantity' | 'position'
  >,
  items: ReadonlyArray<Item> | undefined,
): InvoiceLineCreate | null {
  const item = findItem(items, shipmentLine.item_id);
  if (!item) return null;
  const qtyNum = Number(shipmentLine.quantity);
  const priceNum = Number(item.unit_price_cents);
  if (!Number.isFinite(qtyNum) || !Number.isFinite(priceNum)) return null;
  const lineTotal = roundHalfEven(qtyNum * priceNum);
  return {
    description: item.name,
    quantity: String(shipmentLine.quantity),
    unit_price_cents: String(item.unit_price_cents),
    line_total_cents: String(lineTotal),
    item_id: shipmentLine.item_id,
    sort_order: shipmentLine.position,
  };
}

/**
 * Convert a project_line_items row into an InvoiceLineCreate body.
 *
 * Project lines already carry a `name` plus optional `description` plus
 * `unit_price_cents` directly, so no Item lookup is needed. The
 * project-line shape is the same one project_to_invoice RPC uses for
 * carryover (migration 0045), so this stays in sync with that RPC.
 *
 * Field mapping:
 *   - description     <- project line description, falling back to name
 *   - quantity        <- project line quantity
 *   - unit_price_cents <- project line unit_price_cents
 *   - line_total_cents <- roundHalfEven(qty * price)
 *   - item_id         <- preserved when present (nullable on project lines)
 *   - sort_order      <- project line position
 */
export function projectLineToInvoiceLineCreate(
  projectLine: Pick<
    ProjectLineItem,
    'item_id' | 'name' | 'description' | 'quantity' | 'unit_price_cents' | 'position'
  >,
): InvoiceLineCreate {
  const qtyNum = Number(projectLine.quantity);
  const priceNum = Number(projectLine.unit_price_cents);
  const lineTotal =
    Number.isFinite(qtyNum) && Number.isFinite(priceNum)
      ? roundHalfEven(qtyNum * priceNum)
      : 0;
  const body: InvoiceLineCreate = {
    description: projectLine.description ?? projectLine.name,
    quantity: String(projectLine.quantity),
    unit_price_cents: String(projectLine.unit_price_cents),
    line_total_cents: String(lineTotal),
    sort_order: projectLine.position,
  };
  if (projectLine.item_id) body.item_id = projectLine.item_id;
  return body;
}
