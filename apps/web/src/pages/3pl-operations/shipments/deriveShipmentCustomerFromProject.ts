// B4 (Wave B): derive the customer_id pre-fill for ShipmentCreatePage
// from the currently-selected project. Operator can still override via
// the CustomerPicker after the auto-fill lands.
//
// Why a helper file: keeps the pre-fill rule auditable + unit-testable
// without rendering the page, mirroring the precedent set by
// `deriveInvoiceProjectId.ts` for the inverse direction
// (project derivation from customer on InvoiceCreatePage).

interface ProjectRow {
  id: string;
  customer_id?: string | null;
}

/**
 * Given the loaded project row (or undefined if still fetching) and the
 * caller's current customer state, return either a new customer_id to
 * set on the form, or `null` to mean "do not change". The function
 * never returns an empty string.
 *
 * Rules:
 *   - When project is undefined (still loading), return null (no-op).
 *   - When project.customer_id is missing / empty, return null (the
 *     project is unassigned and we have nothing to copy).
 *   - When the project's customer matches the current form customer
 *     already, return null (avoid a redundant setState that would
 *     trigger re-renders).
 *   - Otherwise return the project's customer_id so the caller can
 *     setCustomerId(...) it.
 */
export function deriveShipmentCustomerFromProject(
  project: ProjectRow | undefined,
  currentCustomerId: string | null,
): string | null {
  if (!project) return null;
  const projectCustomerId = project.customer_id;
  if (!projectCustomerId) return null;
  if (projectCustomerId === currentCustomerId) return null;
  return projectCustomerId;
}
