// BNEW-9: derive a project_id pre-fill for the create-invoice form
// when the upstream caller (a shipment "Create invoice" CTA) could
// only pass customer_id.
//
// Why this exists: shipments don't carry a project_id column today
// (tracked as F-Wave9-UX-Q6-SHIPMENT-LIST-FILTER-01), so the CTA from
// ShipmentDetailPage falls back to a customer-only deep link. To
// preserve the operator's expected pre-fill behaviour (Spec §6.9) we
// pick the most recent active project for that customer on the
// InvoiceCreatePage side, without introducing a schema change in this
// PR.
//
// "Most recent active" means:
//   - same customer_id as the invoice form's customer pre-fill
//   - state is not 'closed' or 'cancelled' (those are the terminal
//     states in the project FSM; we treat the rest as active)
//   - if multiple are active, the one whose updated_at (or
//     created_at fallback) is most recent
//
// Pure helper. Returns null when no candidate is available.

interface ProjectRow {
  id: string;
  customer_id?: string | null;
  state?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
}

const TERMINAL_STATES = new Set(['closed', 'cancelled']);

/**
 * Pick the most recent active project for the given customer from a
 * pre-loaded projects list. Returns null when no candidate exists.
 */
export function deriveInvoiceProjectId(
  projects: ReadonlyArray<ProjectRow> | undefined,
  customerId: string | null,
): string | null {
  if (!customerId || !projects || projects.length === 0) return null;
  const candidates = projects.filter(
    (p) =>
      p.customer_id === customerId &&
      !TERMINAL_STATES.has(p.state ?? ''),
  );
  if (candidates.length === 0) return null;
  // Sort by updated_at, falling back to created_at, descending.
  const sorted = [...candidates].sort((a, b) => {
    const aKey = a.updated_at ?? a.created_at ?? '';
    const bKey = b.updated_at ?? b.created_at ?? '';
    if (aKey === bKey) return 0;
    return aKey < bKey ? 1 : -1;
  });
  return sorted[0]!.id;
}
