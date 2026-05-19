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
// Adding a new flag in a future wave: append to this map under each tier and
// add the named constant to `_shared/constants.ts FEATURE_FLAGS`. The
// provisioning handler picks up new keys automatically.

import { FEATURE_FLAGS } from './constants.ts';

export type PricingTier = 'starter' | 'professional' | 'enterprise';

export const DEFAULT_FLAGS_BY_TIER: Record<
  PricingTier,
  Record<string, boolean>
> = {
  starter: {
    // Plugins
    [FEATURE_FLAGS.PLUGINS_THREE_PL]: true,
    [FEATURE_FLAGS.PLUGINS_MANUFACTURING]: false,
    [FEATURE_FLAGS.PLUGINS_COPACK_ECOM]: false,
    [FEATURE_FLAGS.PLUGINS_KITFORCE]: false,
    [FEATURE_FLAGS.PLUGINS_KITCOST]: false,
    // Add-ons
    [FEATURE_FLAGS.ADDONS_WHITELABEL]: false,
    [FEATURE_FLAGS.ADDONS_KITFORCE]: false,
    [FEATURE_FLAGS.ADDONS_KITCOST]: false,
    // Finance (manual invoicing per decision D-004)
    [FEATURE_FLAGS.FINANCE_JOURNAL_ENTRIES_ENABLED]: false,
    [FEATURE_FLAGS.FINANCE_EXPENSES]: false,
    [FEATURE_FLAGS.FINANCE_CHART_OF_ACCOUNTS]: false,
    // Auth
    [FEATURE_FLAGS.AUTH_SSO_SAML]: false,
  },
  professional: {
    // Plugins
    [FEATURE_FLAGS.PLUGINS_THREE_PL]: true,
    [FEATURE_FLAGS.PLUGINS_MANUFACTURING]: true,
    [FEATURE_FLAGS.PLUGINS_COPACK_ECOM]: true,
    [FEATURE_FLAGS.PLUGINS_KITFORCE]: false,
    [FEATURE_FLAGS.PLUGINS_KITCOST]: false,
    // Add-ons (whitelabel included in tier)
    [FEATURE_FLAGS.ADDONS_WHITELABEL]: true,
    [FEATURE_FLAGS.ADDONS_KITFORCE]: false,
    [FEATURE_FLAGS.ADDONS_KITCOST]: false,
    // Finance
    [FEATURE_FLAGS.FINANCE_JOURNAL_ENTRIES_ENABLED]: true,
    [FEATURE_FLAGS.FINANCE_EXPENSES]: true,
    [FEATURE_FLAGS.FINANCE_CHART_OF_ACCOUNTS]: true,
    // Auth
    [FEATURE_FLAGS.AUTH_SSO_SAML]: false,
  },
  enterprise: {
    // Plugins (all on)
    [FEATURE_FLAGS.PLUGINS_THREE_PL]: true,
    [FEATURE_FLAGS.PLUGINS_MANUFACTURING]: true,
    [FEATURE_FLAGS.PLUGINS_COPACK_ECOM]: true,
    [FEATURE_FLAGS.PLUGINS_KITFORCE]: true,
    [FEATURE_FLAGS.PLUGINS_KITCOST]: true,
    // Add-ons (configurable; default on)
    [FEATURE_FLAGS.ADDONS_WHITELABEL]: true,
    [FEATURE_FLAGS.ADDONS_KITFORCE]: true,
    [FEATURE_FLAGS.ADDONS_KITCOST]: true,
    // Finance
    [FEATURE_FLAGS.FINANCE_JOURNAL_ENTRIES_ENABLED]: true,
    [FEATURE_FLAGS.FINANCE_EXPENSES]: true,
    [FEATURE_FLAGS.FINANCE_CHART_OF_ACCOUNTS]: true,
    // Auth
    [FEATURE_FLAGS.AUTH_SSO_SAML]: true,
  },
};

/**
 * Flat map of default flag values for a tier. Provisioning iterates this to
 * seed one row per flag into public.org_feature_flags.
 */
export function defaultsForTier(tier: PricingTier): Record<string, boolean> {
  return { ...DEFAULT_FLAGS_BY_TIER[tier] };
}
