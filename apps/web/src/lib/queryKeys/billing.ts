/**
 * Billing query keys. Shape `[module, entity, ...args]` mirrors the rest
 * of the SPA. The subscription state lives at one slot per active org;
 * mutations against checkout-session / billing-portal-session invalidate
 * this key on return so the SPA repaints with the new plan.
 */
export const billingKeys = {
  all: ['billing'] as const,
  subscription: ['billing', 'subscription'] as const,
};
