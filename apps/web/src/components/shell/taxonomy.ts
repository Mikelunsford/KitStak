// Page taxonomy labels (R-W13-IA-01).
//
// The page-header eyebrow on every list and detail surface is the breadcrumb
// taxonomy the operator reads to know where a page sits. Before Wave 13 those
// eyebrows used the retired UX-Q1 job-mode words (SELL, MAKE, SHIP, GET PAID,
// LIBRARY, WORKFORCE), which no longer match the pillar-grouped sidebar that
// shipped with ADR 0003. A page could read "Library / Vendors" while the
// sidebar filed Vendors under the Purchasing domain of the SPINE section.
//
// This module is the single source of truth for the top-of-eyebrow taxonomy
// word. Each constant equals the sidebar section label (SIDEBAR_MODES[].label,
// title-cased for the eyebrow) or, for SPINE surfaces, the domain sub-group
// label that drives the SPINE sub-headers (ModeRoute.group). Keeping these as
// named constants lets the regression test assert that the eyebrows and the
// sidebar grouping cannot drift apart again.
//
// Eyebrow shape stays "<Taxonomy> / <Resource>" so the existing PageHeader
// mono eyebrow renders unchanged. The separator stays a forward slash, which
// the branding rule allows (only em dashes and double hyphens are forbidden).

/**
 * SPINE domain sub-groups. These mirror the `group` field on the SPINE routes
 * in sidebarModes.ts (CRM, Quotes, Projects, Catalog, Inventory, Purchasing,
 * Invoicing, Finance, Settings).
 */
export const SPINE_DOMAINS = {
  CRM: 'CRM',
  QUOTES: 'Quotes',
  PROJECTS: 'Projects',
  CATALOG: 'Catalog',
  INVENTORY: 'Inventory',
  PURCHASING: 'Purchasing',
  INVOICING: 'Invoicing',
  FINANCE: 'Finance',
  SETTINGS: 'Settings',
} as const;

/**
 * Add-on section taxonomy words. These mirror the SIDEBAR_MODES section labels
 * for the lit add-ons, written in title case for the eyebrow (the sidebar
 * renders them uppercase via CSS).
 */
export const ADDON_TAXONOMY = {
  THREE_PL: '3PL Operations',
  MANUFACTURING: 'Manufacturing',
  COPACK: 'Co-Pack and Ecom',
  KITFORCE: 'KitForce',
  KITCOST: 'KitCost',
  WMS: 'WMS',
} as const;

export type SpineDomain = (typeof SPINE_DOMAINS)[keyof typeof SPINE_DOMAINS];
export type AddonTaxonomy = (typeof ADDON_TAXONOMY)[keyof typeof ADDON_TAXONOMY];
