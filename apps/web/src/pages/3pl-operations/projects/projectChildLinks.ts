// F-Wave9-AUDIT-V3-WAVE-C4-01: small URL builders for the
// ProjectDetailPage "child entity" deep-link CTAs. Lifted into a
// standalone module so the URL shape is easy to unit-test without
// rendering the page. Mirrors the buildCreateInvoiceUrl helper used
// by InvoiceCreatePage prefill (PR #104 / B1).
//
// The create pages on the receiving side of this pair (C3) read
// ?project_id= and pre-fill the form. If C3 has not shipped yet the
// param is still inert but harmless: the create form will just
// ignore it.

export function buildNewManufacturingRunUrl(projectId: string): string {
  return `/manufacturing/runs/new?project_id=${encodeURIComponent(projectId)}`;
}

export function buildNewShipmentUrl(projectId: string): string {
  return `/3pl-operations/shipments/new?project_id=${encodeURIComponent(projectId)}`;
}

export function buildManufacturingRunDetailUrl(runId: string): string {
  return `/manufacturing/runs/${runId}`;
}

export function buildShipmentDetailUrl(shipmentId: string): string {
  return `/3pl-operations/shipments/${shipmentId}`;
}
