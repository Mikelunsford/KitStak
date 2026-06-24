import { CustomerPicker } from 'kitstak-ui';

export function Closed() {
  return (
    <CustomerPicker
      value=""
      onChange={() => {}}
      label="Customer"
      placeholder="Search customers"
    />
  );
}
