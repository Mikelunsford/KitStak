// Page taxonomy labels (R-W13-IA-01).
//
// The page-header eyebrow on every list and detail surface tells the operator
// which DOMAIN a page belongs to (for example "Invoicing / Invoices",
// "3PL Operations / Accounts"). This is a domain axis.
//
// The UI/UX reconfiguration regrouped the sidebar onto a separate TASK axis
// (SELL, BUY, INVENTORY AND WAREHOUSE, PRODUCTION AND FULFILLMENT, MONEY,
// WORKFORCE, INSIGHTS, SETTINGS), where one task group folds in several domains
// and add-ons. The eyebrow taxonomy and the sidebar section labels are therefore
// intentionally decoupled now: the eyebrow names the domain, the sidebar names
// the task. These constants stay stable domain words so page eyebrows do not
// churn when the sidebar grouping changes. The retired UX-Q1 job-mode words
// (MAKE, SHIP, GET PAID, LIBRARY) must never reappear here.
//
// Eyebrow shape stays "<Taxonomy> / <Resource>" so the existing PageHeader
// mono eyebrow renders unchanged. The separator stays a forward slash, which
// the branding rule allows (only em dashes and double hyphens are forbidden).

/**
 * Spine domain eyebrow words (CRM, Quotes, Projects, Catalog, Inventory,
 * Purchasing, Invoicing, Finance, Settings). These name the domain a backbone
 * page belongs to, independent of which task section the sidebar files it under.
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
 * Add-on domain eyebrow words for the lit add-ons, written in title case (3PL
 * Operations, Manufacturing, Co-Pack and Ecom, KitForce, KitCost, WMS). These
 * name the add-on a page belongs to, independent of the task-based sidebar.
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
