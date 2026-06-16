// R-W13-UX-01: regression tests for transitionInvalidationKeys, the shared
// helper that names the query keys a state-transition mutation must invalidate
// so the detail page (StateStepper, action buttons, totals) and the list update
// without a manual reload.
//
// The finding: after a state-transition mutation succeeds, the entity query
// must be invalidated so the stepper, action buttons, and totals update without
// a manual reload. The receiving and putaway transition hooks previously only
// invalidated the entity tree (`all`), relying on TanStack's prefix match to
// reach the detail key. This test locks the contract that the detail key, the
// entity tree, and the audit timeline are all swept explicitly, so a future
// split of the detail subtree cannot silently drop the stepper refresh.

import { describe, it, expect } from 'vitest';

import { transitionInvalidationKeys } from './transitionInvalidation';
import { receivingOrdersKeys, shipmentsKeys, productionRunsKeys } from '@/lib/queryKeys/ops';
import { wmsPutawayKeys } from '@/lib/queryKeys/wms';
import { invoiceKeys } from '@/lib/queryKeys/invoices';
import { auditLogKeys } from '@/lib/queryKeys/auditLog';

const RECEIVING_ID = 'rcv-00000000-0000-4000-8000-000000000001';
const PUTAWAY_ID = 'pa-00000000-0000-4000-8000-000000000001';
const INVOICE_ID = 'inv-00000000-0000-4000-8000-000000000001';
const SHIPMENT_ID = 'shp-00000000-0000-4000-8000-000000000001';
const PRODUCTION_RUN_ID = 'prn-00000000-0000-4000-8000-000000000001';

// Deep-compare helper so expect().toContainEqual works on readonly tuples.
function asMutable(key: ReadonlyArray<unknown>): unknown[] {
  return key as unknown as unknown[];
}

describe('transitionInvalidationKeys', () => {
  it('invalidates the detail key, the entity tree, and the audit timeline', () => {
    const keys = transitionInvalidationKeys(
      receivingOrdersKeys,
      'receiving_order',
      RECEIVING_ID,
    ).map(asMutable);

    expect(keys).toContainEqual(asMutable(receivingOrdersKeys.detail(RECEIVING_ID)));
    expect(keys).toContainEqual(asMutable(receivingOrdersKeys.all));
    expect(keys).toContainEqual(
      asMutable(auditLogKeys.byEntity('receiving_order', RECEIVING_ID)),
    );
  });

  it('returns exactly the three contract keys (no spurious entries)', () => {
    const keys = transitionInvalidationKeys(
      receivingOrdersKeys,
      'receiving_order',
      RECEIVING_ID,
    );
    expect(keys.length).toBe(3);
  });

  it('names the detail key explicitly so a detail-subtree split keeps the stepper refresh', () => {
    // The detail key must be present in its own right, not only reachable via
    // the `all` prefix. This is the crux of R-W13-UX-01.
    const keys = transitionInvalidationKeys(
      wmsPutawayKeys,
      'putaway_task',
      PUTAWAY_ID,
    ).map(asMutable);
    expect(keys[0]).toEqual(asMutable(wmsPutawayKeys.detail(PUTAWAY_ID)));
  });

  it('works for the putaway entity factory', () => {
    const keys = transitionInvalidationKeys(
      wmsPutawayKeys,
      'putaway_task',
      PUTAWAY_ID,
    ).map(asMutable);

    expect(keys).toContainEqual(asMutable(wmsPutawayKeys.detail(PUTAWAY_ID)));
    expect(keys).toContainEqual(asMutable(wmsPutawayKeys.all));
    expect(keys).toContainEqual(
      asMutable(auditLogKeys.byEntity('putaway_task', PUTAWAY_ID)),
    );
  });

  it('works for the invoice entity factory (detail/all shape)', () => {
    const keys = transitionInvalidationKeys(
      invoiceKeys,
      'invoice',
      INVOICE_ID,
    ).map(asMutable);

    expect(keys).toContainEqual(asMutable(invoiceKeys.detail(INVOICE_ID)));
    expect(keys).toContainEqual(asMutable(invoiceKeys.all));
    expect(keys).toContainEqual(asMutable(auditLogKeys.byEntity('invoice', INVOICE_ID)));
  });

  // F-Wave13-UX-INVALIDATION-REMAINDER-01: the shipment and production-run
  // transition hooks now route through this shared contract, so lock that their
  // key factories expose the detail/all shape the helper depends on.
  it('works for the shipment entity factory', () => {
    const keys = transitionInvalidationKeys(
      shipmentsKeys,
      'shipment',
      SHIPMENT_ID,
    ).map(asMutable);

    expect(keys).toContainEqual(asMutable(shipmentsKeys.detail(SHIPMENT_ID)));
    expect(keys).toContainEqual(asMutable(shipmentsKeys.all));
    expect(keys).toContainEqual(asMutable(auditLogKeys.byEntity('shipment', SHIPMENT_ID)));
  });

  it('works for the production-run entity factory', () => {
    const keys = transitionInvalidationKeys(
      productionRunsKeys,
      'production_run',
      PRODUCTION_RUN_ID,
    ).map(asMutable);

    expect(keys).toContainEqual(asMutable(productionRunsKeys.detail(PRODUCTION_RUN_ID)));
    expect(keys).toContainEqual(asMutable(productionRunsKeys.all));
    expect(keys).toContainEqual(
      asMutable(auditLogKeys.byEntity('production_run', PRODUCTION_RUN_ID)),
    );
  });
});
