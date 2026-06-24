import { StatCard } from 'kitstak-ui';

export function OpenInvoices() {
  return <StatCard to="/invoicing?status=open" count={42} label="Open invoices" />;
}

export function ShipmentsToday() {
  return <StatCard to="/3pl-operations/shipments?window=today" count={18} label="Shipments due today" />;
}

export function ProductionRuns() {
  return <StatCard to="/manufacturing/runs?status=in_production" count={7} label="Runs in production" />;
}

export function ReceivingBacklog() {
  return <StatCard to="/3pl-operations/receiving?status=pending" count={134} label="Pending receipts" />;
}

export function Loading() {
  return <StatCard to="/purchasing/orders?status=draft" count={0} label="Draft purchase orders" loading />;
}
