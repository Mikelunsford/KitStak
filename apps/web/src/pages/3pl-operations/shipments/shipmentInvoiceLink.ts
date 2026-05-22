// Pure helpers for the Shipment -> Invoice next-step CTA (UX-Q4). Lifted
// out of ShipmentDetailPage.tsx so the regression test can import them
// without pulling in the React + Supabase component graph (the SPA's
// `lib/supabase.ts` throws at import time when env vars are absent, which
// happens in the regression-vitest environment).

/**
 * Build the create-invoice deep link for a shipped shipment. Customer is
 * required (caller ensures non-null). Project is optional — Shipment schema
 * does not declare a project_id column today, but the row may carry one as
 * a payload extension. Mirrors the duck-typing in ProjectDetailPage's
 * filter over the shipments list (G-SHIP-FK-01 will add the column).
 */
export function buildCreateInvoiceUrl(
  customerId: string,
  projectId: string | null,
): string {
  const params = new URLSearchParams();
  params.set('customer_id', customerId);
  if (projectId) {
    params.set('project_id', projectId);
  }
  return `/invoicing/invoices/new?${params.toString()}`;
}

/**
 * Read project_id off a Shipment row via a duck-typed cast. The Shipment
 * Zod schema in `_shared/types/vendors_inventory_ops.ts` does not declare
 * project_id today (G-SHIP-FK-01), but the database column may already be
 * present and surfacing through the API. Returns null when the field is
 * absent or non-string-or-empty so the create-invoice URL stays well-formed.
 */
export function getShipmentProjectId(
  shipment: { project_id?: string | null } | Record<string, unknown>,
): string | null {
  const value = (shipment as { project_id?: unknown }).project_id;
  return typeof value === 'string' && value.length > 0 ? value : null;
}
