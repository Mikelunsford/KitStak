# WMS (warehouse execution)

Kitstak's sixth add-on. WMS deepens your warehouse stock down to the bin.

The spine already tracks how much of each item you hold in a warehouse. WMS adds one thing on top: where inside the warehouse each unit sits. It does this without changing a single warehouse total. Your on-hand counts stay exactly as they were; WMS only splits each warehouse number across the bins inside it. Turn the flag off and your stock is precisely what it was before. Nothing is rewritten, nothing is lost.

WMS lives at `/wms`. It is gated by the `plugins.wms` feature flag, which defaults off. WMS is a paid add-on. Until an org admin enables it from `/admin/flags`, the wms-api returns 404 for every route and the pillar pages render empty.

## Where to start

- Map the inside of a warehouse first: `/wms/locations`.
- Watch stock settle into those locations: `/wms/bin-stock`.
- Move received stock off the dock and into its final home: `/wms/putaway`.

## Warehouse locations

`/wms/locations` is where you describe the inside of a warehouse: bins, shelves, racks, docks, and staging areas. Each location carries an operator-facing code (what is painted on the shelf) and sits inside one warehouse.

A location is either active or inactive. Use the active toggle to retire a bin without deleting it; an inactive location drops out of the active list but its history stays intact.

## Bin stock levels

`/wms/bin-stock` is a read-only view of on-hand quantity by location. One row per warehouse, location, item, and lot.

The numbers here always add up to the warehouse total. The bin grain is derived from the same append-only ledger the spine uses, so the sum of every bin inside a warehouse reconciles to that warehouse's on-hand by construction. There is no separate count to keep in step and nothing to reconcile by hand.

## Receiving to dock

When you receive an order, set a dock location on the receiving order header. There is one dock per receipt, set on the header, never per line.

When the receipt posts, every received line lands at that dock. The warehouse total goes up exactly as it always did; WMS simply records that the new stock is sitting on the dock, waiting to be put away.

## Directed putaway

`/wms/putaway` is how you move received stock off the dock into its final bin.

A putaway task moves through three states: `suggested`, `in_progress`, `done` (a task can also be cancelled). Start the task, then complete it once the stock is stowed.

Completing a putaway is an internal move inside the warehouse. The warehouse total does not change. Behind the scenes it records two paired movements, one off the dock and one into the destination bin, the same quantity each way, so the warehouse stays flat while the bin grain shifts the stock from the dock to its final home.

## Lots

`/wms/lots` is where lots live. When you receive a line, you can capture a lot on it, with an optional expiration date. A lot is always optional; capture it where it matters and skip it where it does not.

The lot follows the stock. The receipt credits the lot at the dock, and when you put that stock away the putaway task carries the same lot forward, so the lot-keyed bin row reconciles at the location-and-lot grain. The expiration date is captured today as groundwork. FEFO (first-expired, first-out) consumption is future work.

## Feature flag

WMS is gated by `plugins.wms`, which defaults off. When disabled, the wms-api returns 404 for every route and the pillar pages render empty. Your warehouse totals are unchanged whether the flag is on or off. Org admins enable it from `/admin/flags`.
