// Stripe price-id <-> internal plan slug canon.
//
// D8 (F-Wave10-REVIEW-REMEDIATION): the forward map (plan -> price) and the
// reverse map (price -> plan) previously lived as two independent hardcoded
// copies in billing-api/index.ts and stripe-webhook/index.ts. A silent drift
// between them would route a paid subscription to the wrong tier. Both bundles
// now import from this single module, and stripe-plans.parity.test.ts asserts
// the two maps are exact inverses.
//
// Source of truth for the actual ids is the operator's Stripe dashboard
// (6 SKUs across 3 tiers x 2 cadences). Adding a plan: add the price in
// Stripe, then add it to BOTH maps below and to the billing-api Zod enum.

export const PLAN_TO_PRICE = {
  starter_monthly: 'price_1TbmMV4KMrbWyNl1MPMQrM2a',
  starter_annual: 'price_1TbmSB4KMrbWyNl1QpHy3QQU',
  pro_monthly: 'price_1TbmOU4KMrbWyNl1sbGBK6qz',
  pro_annual: 'price_1TbmSw4KMrbWyNl1rp7mEfLc',
  enterprise_monthly: 'price_1TbmQD4KMrbWyNl1z7vh1f4T',
  enterprise_annual: 'price_1TbmTe4KMrbWyNl186ej636V',
} as const;

export type PlanCode = keyof typeof PLAN_TO_PRICE;

export const PRICE_TO_PLAN: Record<string, PlanCode> = {
  'price_1TbmMV4KMrbWyNl1MPMQrM2a': 'starter_monthly',
  'price_1TbmSB4KMrbWyNl1QpHy3QQU': 'starter_annual',
  'price_1TbmOU4KMrbWyNl1sbGBK6qz': 'pro_monthly',
  'price_1TbmSw4KMrbWyNl1rp7mEfLc': 'pro_annual',
  'price_1TbmQD4KMrbWyNl1z7vh1f4T': 'enterprise_monthly',
  'price_1TbmTe4KMrbWyNl186ej636V': 'enterprise_annual',
};

/**
 * Resolve the internal plan slug for a Stripe price id. Returns null for
 * unknown prices so callers can decide whether to clear, retain, or refuse to
 * write the column.
 */
export function planFromPriceId(
  priceId: string | null | undefined,
): PlanCode | null {
  if (!priceId) return null;
  return PRICE_TO_PLAN[priceId] ?? null;
}
