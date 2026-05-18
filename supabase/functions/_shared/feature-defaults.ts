// Default feature flags per pricing tier.
//
// Seeded when a new org is provisioned. The provisioning handler writes one
// row per (org_id, flag_key) to public.org_feature_flags so every flag read
// has an explicit answer rather than falling through the "absent → false"
// fail-closed path.
//
// Source: PRD pricing. Three tiers: starter, professional, enterprise.
//
// Tier policy summary:
//   starter        single plugin (3PL by default), no whitelabel, manual
//                  invoicing (no JE), no KitForce, no KitCost.
//   professional   all three core plugins, whitelabel included, journal
//                  entries on, expenses on.
//   enterprise     everything above plus KitForce, KitCost, and SSO.
//
// Adding a new flag in a future wave: append to this map under each tier.
// The provisioning handler picks up new keys automatically.

export type PricingTier = 'starter' | 'professional' | 'enterprise';

export const DEFAULT_FLAGS_BY_TIER: Record<
  PricingTier,
  Record<string, boolean>
> = {
  starter: {
    // Plugins
    'plugins.3pl': true,
    'plugins.manufacturing': false,
    'plugins.copack_ecom': false,
    'plugins.kitforce': false,
    'plugins.kitcost': false,
    // Add-ons
    'addons.whitelabel': false,
    'addons.kitforce': false,
    'addons.kitcost': false,
    // Finance (manual invoicing per decision D-004)
    'finance.journal_entries.enabled': false,
    'finance.expenses': false,
    'finance.chart_of_accounts': false,
    // Auth
    'auth.sso_saml': false,
  },
  professional: {
    // Plugins
    'plugins.3pl': true,
    'plugins.manufacturing': true,
    'plugins.copack_ecom': true,
    'plugins.kitforce': false,
    'plugins.kitcost': false,
    // Add-ons (whitelabel included in tier)
    'addons.whitelabel': true,
    'addons.kitforce': false,
    'addons.kitcost': false,
    // Finance
    'finance.journal_entries.enabled': true,
    'finance.expenses': true,
    'finance.chart_of_accounts': true,
    // Auth
    'auth.sso_saml': false,
  },
  enterprise: {
    // Plugins (all on)
    'plugins.3pl': true,
    'plugins.manufacturing': true,
    'plugins.copack_ecom': true,
    'plugins.kitforce': true,
    'plugins.kitcost': true,
    // Add-ons (configurable; default on)
    'addons.whitelabel': true,
    'addons.kitforce': true,
    'addons.kitcost': true,
    // Finance
    'finance.journal_entries.enabled': true,
    'finance.expenses': true,
    'finance.chart_of_accounts': true,
    // Auth
    'auth.sso_saml': true,
  },
};

/**
 * Flat map of default flag values for a tier. Provisioning iterates this to
 * seed one row per flag into public.org_feature_flags.
 */
export function defaultsForTier(tier: PricingTier): Record<string, boolean> {
  return { ...DEFAULT_FLAGS_BY_TIER[tier] };
}
