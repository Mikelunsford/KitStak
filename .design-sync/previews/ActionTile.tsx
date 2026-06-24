import { ActionTile } from 'kitstak-ui';

export function ReceivingTile() {
  return (
    <ActionTile
      to="/3pl-operations/receiving"
      title="Receiving"
      body="Log inbound shipments and reconcile against open purchase orders."
    />
  );
}

export function ProductionTile() {
  return (
    <ActionTile
      to="/manufacturing/runs"
      title="Production runs"
      body="Start, track, and close work orders across the shop floor."
    />
  );
}

export function BillingReviewTile() {
  return (
    <ActionTile
      to="/invoicing"
      title="Billing review"
      body="Approve drafted charges before they post to customer invoices."
    />
  );
}

export function TileGrid() {
  return (
    <div className="grid grid-cols-2 gap-4">
      <ActionTile
        to="/quotes"
        title="Quotes"
        body="Build tiered quotes for Acme Logistics and Northwind Freight."
      />
      <ActionTile
        to="/purchasing/orders"
        title="Purchasing"
        body="Raise purchase orders and track supplier commitments."
      />
    </div>
  );
}
