import { TaxPicker } from 'kitstak-ui';

export function Closed() {
  return (
    <TaxPicker
      value=""
      onChange={() => {}}
      label="Default tax"
      placeholder="Use org default"
    />
  );
}
