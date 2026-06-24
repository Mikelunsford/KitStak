import { Tabs } from 'kitstak-ui';

export function OrderSections() {
  return (
    <Tabs
      aria-label="Order sections"
      tabs={[
        { key: 'overview', label: 'Overview', panel: <div className="p-4 text-ink">Order summary, customer, and totals.</div> },
        { key: 'lines', label: 'Line items', panel: <div className="p-4 text-ink">12 line items across 3 SKUs.</div> },
        { key: 'activity', label: 'Activity', panel: <div className="p-4 text-ink">Created, approved, and shipped events.</div> },
      ]}
    />
  );
}
