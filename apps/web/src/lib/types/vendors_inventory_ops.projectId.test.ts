// F-Wave9-AUDIT-V3-WAVE-C2-01 unit tests.
//
// Pinpoint schema-level assertions for the project_id linkage on
// manufacturing_runs and shipments. These guard the four parse paths
// that the regression suite (test/regression/audit-v3-c2-project-id-
// round-trip.test.ts) exercises end-to-end:
//
//   1. Schema parses when project_id is present (UUID).
//   2. Schema parses when project_id is omitted entirely.
//   3. Schema parses when project_id is explicitly null.
//   4. Schema rejects a non-UUID string with a Zod error.
//
// These two halves of the contract are sourced from the same byte-
// identical side-car file (the _shared copy is the SPA mirror).

import { describe, expect, it } from 'vitest';

import {
  ManufacturingRunCreateSchema,
  ShipmentSchema,
} from './vendors_inventory_ops';

const VALID_UUID = '00000000-0000-4000-8000-0000000000d1';
const VALID_UUID_2 = '00000000-0000-4000-8000-0000000000d2';
const VALID_UUID_3 = '00000000-0000-4000-8000-0000000000d3';
const VALID_UUID_WH = '00000000-0000-4000-8000-0000000000c1';
const VALID_UUID_ORG = '00000000-0000-4000-8000-0000000000a1';

// ---------------------------------------------------------------------------
// ManufacturingRunCreateSchema — write-side body schema
// ---------------------------------------------------------------------------

describe('ManufacturingRunCreateSchema — project_id linkage', () => {
  it('parses with project_id present (UUID)', () => {
    const result = ManufacturingRunCreateSchema.safeParse({
      run_number: 'TEST-MFG-001',
      warehouse_id: VALID_UUID_WH,
      project_id: VALID_UUID,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.project_id).toBe(VALID_UUID);
    }
  });

  it('parses with project_id absent (field omitted)', () => {
    const result = ManufacturingRunCreateSchema.safeParse({
      run_number: 'TEST-MFG-002',
      warehouse_id: VALID_UUID_WH,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.project_id).toBeUndefined();
    }
  });

  it('parses with project_id explicitly null', () => {
    const result = ManufacturingRunCreateSchema.safeParse({
      run_number: 'TEST-MFG-003',
      warehouse_id: VALID_UUID_WH,
      project_id: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.project_id).toBeNull();
    }
  });

  it('rejects a non-UUID string in project_id', () => {
    const result = ManufacturingRunCreateSchema.safeParse({
      run_number: 'TEST-MFG-004',
      warehouse_id: VALID_UUID_WH,
      project_id: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join('.') === 'project_id')).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// ShipmentSchema — read-side row schema (also drives the create response
// envelope parse and the SPA's services.shipmentsService.createShipment
// return value). The write-side ShipmentCreate lives inline in
// supabase/functions/ops-api/index.ts because it spreads to ...body; the
// row schema is the right pinpoint test target for the SPA-bundled Zod.
// ---------------------------------------------------------------------------

function makeBaseShipmentRow(): Record<string, unknown> {
  return {
    id: VALID_UUID_2,
    org_id: VALID_UUID_ORG,
    shipment_number: 'TEST-SHP-001',
    warehouse_id: VALID_UUID_WH,
    customer_id: null,
    sales_order_id: null,
    status: 'created',
    ship_date: null,
    carrier: null,
    tracking_number: null,
    notes: null,
    payload: {},
    created_at: '2026-05-23T00:00:00.000Z',
    updated_at: '2026-05-23T00:00:00.000Z',
  };
}

describe('ShipmentSchema — project_id linkage', () => {
  it('parses with project_id present (UUID)', () => {
    const result = ShipmentSchema.safeParse({
      ...makeBaseShipmentRow(),
      project_id: VALID_UUID_3,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.project_id).toBe(VALID_UUID_3);
    }
  });

  it('parses with project_id absent (legacy row, field omitted)', () => {
    const result = ShipmentSchema.safeParse(makeBaseShipmentRow());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.project_id).toBeUndefined();
    }
  });

  it('parses with project_id explicitly null (unlinked row)', () => {
    const result = ShipmentSchema.safeParse({
      ...makeBaseShipmentRow(),
      project_id: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.project_id).toBeNull();
    }
  });

  it('rejects a non-UUID string in project_id', () => {
    const result = ShipmentSchema.safeParse({
      ...makeBaseShipmentRow(),
      project_id: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join('.') === 'project_id')).toBe(true);
    }
  });
});
