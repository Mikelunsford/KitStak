// Regression suite for R-Wave6-PERF-01 — unbounded inventory list endpoints.
//
// Audit finding (03-workspace/journal/2026-05-18-drift-performance.md §7):
//   Three GET endpoints in `inventory-api` return every row in the tenant
//   with no `.limit()` and no cursor. RED the moment a tenant has 500+
//   warehouses, stock levels, or BOM lines.
//
// Targets:
//   * supabase/functions/inventory-api/index.ts:60-72   GET /warehouses
//   * supabase/functions/inventory-api/index.ts:140-157 GET /stock-levels
//   * supabase/functions/inventory-api/index.ts:179-193 GET /bom-items
//
// Constitutional invariant protected:
//   00-canon/01-architecture.md §152-156 — all list endpoints MUST be
//   cursor-paginated. An operator with 500+ SKUs across multiple warehouses
//   should never receive an unbounded payload that the SPA must filter
//   client-side. The constitution also says `parseLimit` clamps `?limit=`
//   to [1, 200]; an absent limit defaults to 50.
//
// Each test seeds N rows where N exceeds the default page size, invokes
// the handler with a forged JWT, and asserts:
//   1. The response shape is `{ items, next_cursor }` (the canonical
//      paginated envelope). Currently fails because the handler returns
//      `data: <array>` directly.
//   2. `items.length <= 50` (the default page size from parseLimit).
//   3. `next_cursor` is a non-null string when more rows exist.
//
// All three endpoints live in the same module; we use one beforeAll to
// import it so Vitest's per-URL module cache does not strand the captured
// handler between describes.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  installDenoShim,
  capturedHandler,
  resetCapturedHandler,
} from './_helpers/deno-shim.ts';
import {
  makeState,
  bearer,
} from './_helpers/supabase-mock.ts';
import {
  setActiveMockState,
  clearActiveMockState,
} from './_helpers/supabase-stub.ts';

const ORG_A = '00000000-0000-4000-8000-0000000000a1';
const USER_A = '00000000-0000-4000-8000-0000000000b1';
const OWNER = { userId: USER_A, orgId: ORG_A, role: 'org_owner' as const };
const DEFAULT_LIMIT = 50;

function iso(secondsAgo: number): string {
  return new Date(Date.now() - secondsAgo * 1000).toISOString();
}
function uuid(seq: number): string {
  const hex = seq.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
}

async function readJson(res: Response): Promise<unknown> {
  return JSON.parse(await res.text());
}

function expectPaginatedEnvelope(
  body: { data: unknown },
  maxItems: number,
): asserts body is {
  data: { items: unknown[]; next_cursor: string | null };
} {
  const d = body.data as { items?: unknown; next_cursor?: unknown };
  expect(Array.isArray(d.items)).toBe(true);
  expect('next_cursor' in d).toBe(true);
  expect((d.items as unknown[]).length).toBeLessThanOrEqual(maxItems);
}

describe('inventory-api list endpoints — pagination regression (R-Wave6-PERF-01)', () => {
  let handler: (req: Request) => Promise<Response> | Response;

  beforeAll(async () => {
    installDenoShim();
    resetCapturedHandler();
    await import('../../../../supabase/functions/inventory-api/index.ts');
    handler = capturedHandler();
  });

  afterEach(() => clearActiveMockState());

  it('GET /warehouses returns {items, next_cursor} and never exceeds default limit', async () => {
    const N = DEFAULT_LIMIT + 10;
    const rows = Array.from({ length: N }).map((_, i) => ({
      id: uuid(i + 1),
      org_id: ORG_A,
      code: `WH-${String(i + 1).padStart(4, '0')}`,
      display_name: `Warehouse ${i + 1}`,
      is_default: false,
      address_line1: null,
      address_line2: null,
      city: null,
      region: null,
      postal_code: null,
      country_code: null,
      notes: null,
      is_active: true,
      created_at: iso(N - i),
      updated_at: iso(N - i),
      deleted_at: null,
    }));
    setActiveMockState(makeState({ warehouses: rows }));

    const req = new Request('https://example.test/warehouses', {
      method: 'GET',
      headers: { authorization: bearer(OWNER) },
    });
    const res = await handler(req);
    expect(res.status).toBe(200);

    const body = (await readJson(res)) as { data: unknown };
    expectPaginatedEnvelope(body, DEFAULT_LIMIT);
    expect(body.data.next_cursor).not.toBeNull();
    expect(typeof body.data.next_cursor).toBe('string');
  });

  it('GET /stock-levels returns {items, next_cursor} and never exceeds default limit', async () => {
    const N = DEFAULT_LIMIT + 25;
    const warehouseId = uuid(9000);
    const rows = Array.from({ length: N }).map((_, i) => ({
      id: uuid(i + 1),
      org_id: ORG_A,
      warehouse_id: warehouseId,
      item_id: uuid(2000 + i),
      quantity_on_hand: '0',
      quantity_reserved: '0',
      quantity_in_transit: '0',
      quantity_available: '0',
      last_movement_at: null,
      updated_at: iso(N - i),
      created_at: iso(N - i),
    }));
    setActiveMockState(makeState({ stock_levels: rows }));

    const req = new Request('https://example.test/stock-levels', {
      method: 'GET',
      headers: { authorization: bearer(OWNER) },
    });
    const res = await handler(req);
    expect(res.status).toBe(200);

    const body = (await readJson(res)) as { data: unknown };
    expectPaginatedEnvelope(body, DEFAULT_LIMIT);
    expect(body.data.next_cursor).not.toBeNull();
    expect(typeof body.data.next_cursor).toBe('string');
  });

  it('GET /bom-items returns {items, next_cursor} and never exceeds default limit', async () => {
    const N = DEFAULT_LIMIT + 5;
    const parentId = uuid(9001);
    const rows = Array.from({ length: N }).map((_, i) => ({
      id: uuid(i + 1),
      org_id: ORG_A,
      parent_item_id: parentId,
      component_item_id: uuid(3000 + i),
      quantity_per: '1',
      unit_of_measure: null,
      notes: null,
      sort_order: i,
      created_at: iso(N - i),
      updated_at: iso(N - i),
    }));
    setActiveMockState(makeState({ bom_items: rows }));

    const req = new Request('https://example.test/bom-items', {
      method: 'GET',
      headers: { authorization: bearer(OWNER) },
    });
    const res = await handler(req);
    expect(res.status).toBe(200);

    const body = (await readJson(res)) as { data: unknown };
    expectPaginatedEnvelope(body, DEFAULT_LIMIT);
    expect(body.data.next_cursor).not.toBeNull();
    expect(typeof body.data.next_cursor).toBe('string');
  });
});
