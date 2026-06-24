import { VendorPicker } from 'kitstak-ui';

export function Closed() {
  return (
    <VendorPicker
      value=""
      onChange={() => {}}
      label="Vendor"
      placeholder="Search vendors"
    />
  );
}
