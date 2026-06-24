import { InvoicePicker } from 'kitstak-ui';

export function Closed() {
  return (
    <InvoicePicker
      value=""
      onChange={() => {}}
      label="Invoice"
      placeholder="Select an invoice"
    />
  );
}
