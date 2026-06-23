// P1-2: option-label formatters for the tax / payment-method / pricing-tier
// reference pickers. Pulled out as pure functions (the pickers themselves are
// thin native <select> wrappers with no other logic) so the vitest suite can
// pin the option text without a DOM. The repo has no jsdom / testing-library,
// so the formatters are the testable surface; the existing pickers are untested
// for the same reason.

import type { PaymentMethod, PricingTier, Tax } from '@/lib/types/sales';

function bpsToPercent(bps: number): string {
  return (bps / 100).toFixed(2);
}

/** "Standard (8.25%)" or "Standard (8.25%) · default" for the org default. */
export function taxOptionLabel(tax: Tax): string {
  const base = `${tax.name} (${bpsToPercent(tax.rate_bps)}%)`;
  return tax.default_for_org ? `${base} · default` : base;
}

/** The payment method's display label, marking the org default. */
export function paymentMethodOptionLabel(method: PaymentMethod): string {
  return method.default_for_org ? `${method.label} · default` : method.label;
}

/** "Wholesale (10.00% off)". Pricing tiers have no org default. */
export function pricingTierOptionLabel(tier: PricingTier): string {
  return `${tier.name} (${bpsToPercent(tier.discount_bps)}% off)`;
}
