# KitCost

Kitstak's fifth add-on. KitCost is a read-only cost and margin dashboard. It does not add new data of its own; it reads what the spine and the other add-ons already record and presents the money story in one place.

KitCost is a paid add-on gated by the `plugins.kitcost` feature flag, which defaults off. Until an org admin enables it from `/admin/flags`, the dashboard renders empty.

## The dashboard

KitCost lives at `/kitcost/dashboard`. Viewing it requires the `kitcost.dashboard.view` capability. The whole page loads from a single read of `/dashboard-api/kitcost/summary`, then composes the panels below from that one round trip.

### Headline numbers

Four key figures sit at the top:

- Total revenue year to date.
- Invoiced this month.
- Active projects.
- Inventory value.

### Revenue trend

A line chart of revenue by month, oldest first. KitCost derives the month-over-month growth, the trailing three-month average, and the best and worst months from that series.

### Top customers

A bar chart of your largest customers by revenue, with each customer's share of the top-customer revenue so you can see concentration risk at a glance. A table below repeats the figures with cumulative share.

### Project margins

A bar chart pairing revenue against cost per project, plus a margin detail table sorted so the thinnest and negative margins surface first. Projects are bucketed into four margin-health bands: negative, thin, healthy, and strong. The project margin table exports to CSV.

## Money handling

Every monetary value is stored and summed as integer cents (BIGINT in Postgres), so the totals never drift on floating point. Percentages are computed by division and shown to one decimal place. The CSV export renders cents back to a whole-and-fraction figure for spreadsheets.

KitCost is the only Kitstak surface that draws charts; it loads the charting library lazily so the rest of the app stays lean.
