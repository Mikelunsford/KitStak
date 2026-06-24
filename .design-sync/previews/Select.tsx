import { Select } from 'kitstak-ui';

export function Default() {
  return (
    <Select aria-label="Status">
      <option value="all">All statuses</option>
      <option value="paid">Paid</option>
      <option value="overdue">Overdue</option>
      <option value="draft">Draft</option>
    </Select>
  );
}

export function WithValue() {
  return (
    <Select aria-label="Warehouse" defaultValue="tacoma">
      <option value="tacoma">Tacoma DC</option>
      <option value="reno">Reno DC</option>
      <option value="memphis">Memphis DC</option>
    </Select>
  );
}

export function Disabled() {
  return (
    <Select aria-label="Customer" defaultValue="acme" disabled>
      <option value="acme">Acme Logistics</option>
    </Select>
  );
}
