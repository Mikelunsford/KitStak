import { StatusBadge } from 'kitstak-ui';

export function Paid() {
  return <StatusBadge status="paid" />;
}

export function PartiallyPaid() {
  return <StatusBadge status="partially_paid" />;
}

export function Overdue() {
  return <StatusBadge status="overdue" />;
}

export function InProduction() {
  return <StatusBadge status="in_production" />;
}

export function Draft() {
  return <StatusBadge status="draft" />;
}
