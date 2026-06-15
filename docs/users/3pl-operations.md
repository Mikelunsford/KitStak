# 3PL Operations

Kitstak's first add-on. Two layers. The warehouse floor: receiving, production, kitting, shipments, backed by vendors, purchase orders, vendor bills, expenses, warehouses, stock levels, BOMs. The commercial layer on top: accounts and rate cards, job builders, supply plans, job runs, billing review, and job profitability.

## Where to start

- Set up your first warehouse: `/3pl-operations/warehouses`. The provisioning flow seeds a default; you can rename it.
- Add vendors: `/3pl-operations/vendors`.
- Write purchase orders: `/3pl-operations/purchase-orders`.

## Receiving

A receiving order has four states: `created`, `in_progress`, `received`, `cancelled`. Use the **Receive** action to record received lines; this transitions the order to `received` and emits stock movements automatically.

## Production runs

A production run has four states: `planned`, `in_progress`, `completed`, `cancelled`. Start the run from the detail page; complete it with consumed components and produced output. Stock movements are emitted on completion.

## Shipments

A shipment has four states: `created`, `picking`, `shipped`, `cancelled`. The **Ship** action transitions a shipment from `picking` (or `created`) to `shipped` and records the outbound stock movement.

## Stock

Stock levels are read-only. Available quantity is `on_hand - reserved`, derived in the database. Movements are an append-only ledger; everything flows through triggers on receiving, production, and shipment transitions.

## The commercial layer

The surfaces above are the warehouse floor. On top of them sits the 3PL commercial layer: how you price the work, build it into reusable jobs, plan the materials, run it day by day, and bill it.

### Accounts

`/3pl-operations/accounts` is the service-relationship layer over a CRM customer. One customer can be a buyer in the CRM and a managed account here. The account carries a per-account rate card: a set of service definitions, each with its own rate. Those account rates are the ones billing uses later, so the price you quote and the price you bill come from the same place.

An account is active or inactive. Deactivate drops it out of the active list; you can reactivate it later. The detail page shows the rate card and a history rail.

### Job Builders

`/3pl-operations/job-builders` holds reusable job templates. A template is built from three kinds of line: component lines (an item), service lines (a value-added service), and step lines (a labor step). Lines sit under a branded variant preset so the template reflects how that job actually runs.

Apply a template to a quote and its lines expand into quote lines in one move. Priced steps carry across as line items. Build the job once, reuse it on every quote that needs it.

### Supply Plans

`/3pl-operations/supply-plans` resolves a project's material demand against your on-hand stock. Each demand line shows required, available, reserved, and the shortage per item.

Release reserves the available stock (it writes reserve movements on the spine ledger, so the warehouse's reserved quantity reflects the hold) and surfaces what is short. Cancel releases the holds. A plan is a draft until you release it; the add-line form and the actions are gated to the right state, and the server is the authority.

### Job Runs

`/3pl-operations/job-runs` is the day-by-day execution of a project on the floor. A run moves through start, complete, close, and cancel.

Each run carries daily logs. A daily log records what was consumed and what was produced that day. Posting a draft log emits the spine stock movements (consumed out, produced in) and freezes the log, so the floor's actual usage flows straight into stock.

### Billing Review

`/3pl-operations/billing-reviews` is an estimate-versus-actual check before you invoice. The panel compares the quote estimate against what the job actually consumed and produced.

Approve creates a draft invoice on the spine, with lines built from the account's service rates, and lands the review in approved. The draft invoice then runs through the normal invoicing flow (see the finance guide). Approve is one direction; you can also cancel a review.

### Job Profitability

`/3pl-operations/profitability` is a read-only view, one row per job run. It lines up three numbers side by side: the quote estimate, the actuals (posted daily-log labor plus consumed material), and the billed revenue from the project's invoices. Margin is revenue minus actual, and it can be negative when a job runs at a loss. Nothing is written here; it is a reporting surface only.

## Feature flag

The 3PL operations bundle is gated by `plugins.three_pl`. When disabled, the ops-api returns 404 for every route and the pillar pages render empty. Org admins enable it from `/admin/flags`.
