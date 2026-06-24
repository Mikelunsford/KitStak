import { PricingTierPicker } from 'kitstak-ui';

export function Closed() {
  return (
    <PricingTierPicker
      value=""
      onChange={() => {}}
      label="Pricing tier"
      placeholder="No pricing tier"
    />
  );
}
