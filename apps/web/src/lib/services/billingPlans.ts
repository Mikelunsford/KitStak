// Pure plan canon. Lives in its own file so unit tests can import the
// catalog without transitively pulling apiClient / supabase. Mirrors the
// shape of paymentInvalidation.ts and other BNEW-* pure helpers.
//
// Six plans: three tiers (starter / pro / enterprise) x two cadences
// (monthly / annual). Annual is 15% off the 12x monthly run-rate per
// the Stripe-wiring brief. Prices stored in cents per the constitution.

export type PlanCode =
  | 'starter_monthly'
  | 'starter_annual'
  | 'pro_monthly'
  | 'pro_annual'
  | 'enterprise_monthly'
  | 'enterprise_annual';

export type PlanCadence = 'monthly' | 'annual';
export type PlanTier = 'starter' | 'pro' | 'enterprise';

export interface PlanSpec {
  code: PlanCode;
  tier: PlanTier;
  tierLabel: string;
  cadence: PlanCadence;
  cadenceLabel: string;
  price_cents: number;
  /**
   * Display label. "Starter Monthly", "Professional Annual", etc.
   * Centralised so the BillingPage card and the current-plan card render
   * the same string.
   */
  displayName: string;
}

export const PLAN_CATALOG: ReadonlyArray<PlanSpec> = [
  {
    code: 'starter_monthly',
    tier: 'starter',
    tierLabel: 'Starter',
    cadence: 'monthly',
    cadenceLabel: 'Monthly',
    price_cents: 80000,
    displayName: 'Starter Monthly',
  },
  {
    code: 'starter_annual',
    tier: 'starter',
    tierLabel: 'Starter',
    cadence: 'annual',
    cadenceLabel: 'Annual',
    price_cents: 816000,
    displayName: 'Starter Annual',
  },
  {
    code: 'pro_monthly',
    tier: 'pro',
    tierLabel: 'Professional',
    cadence: 'monthly',
    cadenceLabel: 'Monthly',
    price_cents: 180000,
    displayName: 'Professional Monthly',
  },
  {
    code: 'pro_annual',
    tier: 'pro',
    tierLabel: 'Professional',
    cadence: 'annual',
    cadenceLabel: 'Annual',
    price_cents: 1836000,
    displayName: 'Professional Annual',
  },
  {
    code: 'enterprise_monthly',
    tier: 'enterprise',
    tierLabel: 'Enterprise',
    cadence: 'monthly',
    cadenceLabel: 'Monthly',
    price_cents: 350000,
    displayName: 'Enterprise Monthly',
  },
  {
    code: 'enterprise_annual',
    tier: 'enterprise',
    tierLabel: 'Enterprise',
    cadence: 'annual',
    cadenceLabel: 'Annual',
    price_cents: 3570000,
    displayName: 'Enterprise Annual',
  },
] as const;

export const PLAN_CODES: ReadonlyArray<PlanCode> = PLAN_CATALOG.map(
  (p) => p.code,
);

export function planByCode(code: string | null | undefined): PlanSpec | null {
  if (!code) return null;
  return PLAN_CATALOG.find((p) => p.code === code) ?? null;
}
