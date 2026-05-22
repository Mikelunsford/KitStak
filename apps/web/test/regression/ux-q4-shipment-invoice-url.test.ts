// Regression suite for UX-Q4 — Shipment -> Invoice deep-link builder.
//
// Targets the two pure helpers exported by
// `apps/web/src/pages/3pl-operations/shipments/ShipmentDetailPage.tsx`:
//   * buildCreateInvoiceUrl(customer_id, project_id | null)
//   * getShipmentProjectId(shipment)
//
// Constitutional invariant protected: the create-invoice form already reads
// `customer_id` and `project_id` from query params (InvoiceCreatePage). If
// the deep-link drops one of those params on a shipped row that carries it,
// the operator lands on a half-filled form and the workflow stalls.

import { describe, it, expect } from 'vitest';

import {
  buildCreateInvoiceUrl,
  getShipmentProjectId,
} from '../../src/pages/3pl-operations/shipments/shipmentInvoiceLink';

describe('buildCreateInvoiceUrl', () => {
  it('emits customer_id only when project_id is null', () => {
    const url = buildCreateInvoiceUrl('cust-1', null);
    expect(url).toBe('/invoicing/invoices/new?customer_id=cust-1');
  });

  it('emits both params when project_id is present', () => {
    const url = buildCreateInvoiceUrl('cust-1', 'proj-1');
    expect(url).toBe(
      '/invoicing/invoices/new?customer_id=cust-1&project_id=proj-1',
    );
  });

  it('url-encodes a customer_id with reserved characters', () => {
    const url = buildCreateInvoiceUrl('c+1', null);
    // URLSearchParams encodes '+' as '%2B' so the receiver re-decodes it
    // as a literal plus rather than a space.
    expect(url).toBe('/invoicing/invoices/new?customer_id=c%2B1');
  });
});

describe('getShipmentProjectId', () => {
  it('returns the string when the field is a non-empty string', () => {
    expect(getShipmentProjectId({ project_id: 'proj-1' })).toBe('proj-1');
  });

  it('returns null when the field is absent', () => {
    expect(getShipmentProjectId({})).toBeNull();
  });

  it('returns null when the field is explicitly null', () => {
    expect(getShipmentProjectId({ project_id: null })).toBeNull();
  });

  it('returns null when the field is an empty string', () => {
    expect(getShipmentProjectId({ project_id: '' })).toBeNull();
  });

  it('returns null when the field is a non-string value', () => {
    // Defensive against an API drift that returns a number, UUID-bytes
    // object, etc. Should never reach the URL builder as anything other
    // than a string.
    expect(
      getShipmentProjectId({ project_id: 42 } as unknown as { project_id: string | null }),
    ).toBeNull();
  });
});
