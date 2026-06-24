import { PaymentMethodPicker } from 'kitstak-ui';

export function Closed() {
  return (
    <PaymentMethodPicker
      value=""
      onChange={() => {}}
      label="Payment method"
      placeholder="Use org default"
    />
  );
}
