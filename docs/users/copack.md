# Co-Pack and Ecom

Kitstak's third add-on. Co-Pack and Ecom covers sales channels, sales orders, kitting jobs, and the pick-pack-ship fulfillment flow.

Co-Pack and Ecom is a paid add-on gated by the `plugins.copack_ecom` feature flag, which defaults off. Until an org admin enables it from `/admin/flags`, the surface renders empty and the copack-api returns 404 on every route.

## Sales channels

A sales channel records where an order came from. Channels are manual today: when you create or edit one, the kind must be Manual. Older channels imported from other systems stay readable, but anything you add or change is a manual channel.

## Sales orders

The order lifecycle has six states: draft, confirmed, picking, packed, shipped, cancelled. Shipped is the end of the line. Cancel is reachable from every state except shipped.

1. Click New Order and pick a channel and a customer. Kitstak assigns the next order number with an `SO-` prefix unless you supply your own.
2. While the order is in draft, add line items. Each line points at a catalog item.
3. Confirm locks the header and moves the order out of draft.
4. The picking, packed, and shipped states are driven by fulfillments, covered below.

You can only edit an order's header or its lines while it is in draft.

## Kitting jobs

A kitting job is an assembly batch: consume components, produce kits. The lifecycle is draft, started, completed, cancelled. Completed is the end of the line.

1. Click New Kitting Job and set a warehouse. Kitstak assigns the next job number with a `KIT-` prefix.
2. While the job is in draft, add consumed lines for the components it uses and produced lines for the kits it makes. A produced line can name an output you do not yet stock.
3. Start moves the job into production.
4. Complete closes the job and posts the stock movements: the components come off hand and the kits go on hand, in one step. A job must have a warehouse before it can complete, because completion is what moves the stock.
5. Cancel is reachable from draft or started.

## Fulfillments

A fulfillment is the pick-pack-ship pass against a sales order. The lifecycle is pending, picking, packed, shipped, cancelled. Shipped is the end of the line; cancel is reachable from every state except shipped.

1. Create a fulfillment against an order. Kitstak assigns the next number with a `FULF-` prefix.
2. Pick, Pack, and Ship walk the fulfillment forward one step at a time.
3. When a fulfillment ships, Kitstak advances the parent sales order to shipped for you, so the order and its fulfillment stay in step.

## Money handling

Every monetary value is stored as integer cents (BIGINT in Postgres). Line amounts never use floating point.

## Audit

Every order, kitting job, and fulfillment state transition writes a row to `audit_log`. Kitting completions post their stock movements to the same append-only ledger the rest of Kitstak reads from, so your warehouse on-hand stays consistent.
