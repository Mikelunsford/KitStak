# CRM (for operators)

Wave 2 of Kitstak ships CRM. Five surfaces: customers, contacts, activities,
leads, opportunities.

## Customers

Open `/crm/customers` from the sidebar. Search by display name, filter by
status (new, active, inactive). Click a row to see the detail page. The
`NEW CUSTOMER` button takes you to the create form. Every customer row
carries a billing and shipping address plus a default currency that snapshots
onto downstream documents (quotes, invoices) when they ship in later waves.

## Contacts

Open `/crm/contacts`. Contacts belong to a customer; the customer detail page
links into the filtered contacts list for that customer. Mark one contact
as primary per customer (unique).

## Activities

`/crm/activities`. Calls, meetings, emails, notes, and tasks logged against
any customer / contact / lead / opportunity. Status: open, completed,
cancelled. Open activities surface in the default list.

## Leads

`/crm/leads` shows the lead kanban: new, working, qualified, converted,
disqualified. Open a lead to see detail and qualify or disqualify it. When a
lead reaches `qualified`, the detail page exposes a `CONVERT` button that
transactionally:

1. Optionally creates a new customer (or links an existing one).
2. Creates an opportunity in stage `discovery`.
3. Stamps the lead with `converted_customer_id`, `converted_opportunity_id`,
   `converted_at`, and `status = converted`.

All three writes happen under one Postgres transaction (RPC
`public.convert_lead`). A re-submitted convert returns `409
STATE_CONFLICT` so you never accidentally create a duplicate opportunity.

## Opportunities

`/crm/opportunities` is the pipeline view: six stages from `discovery`
through `closed_won` or `closed_lost`. The detail page shows allowed
transitions per the FSM, so you cannot skip from `discovery` straight to
`negotiation`. The server is authority; the SPA only hides the disallowed
buttons.

Amounts are stored and displayed in cents (bigint). Future waves add a
currency formatter and the quote / invoice surfaces that consume the won
opportunities.
