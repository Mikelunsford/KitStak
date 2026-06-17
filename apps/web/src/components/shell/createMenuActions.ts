// Quick-create registry for the Topbar Create (+) menu. Kept as pure data plus
// a pure filter so the role/entitlement gating is unit-testable without a
// renderer (mirrors the commandBarModel.ts / dashboardTiles.ts precedent).
//
// Each action is gated by a capability (mirrors the server requireCap) and an
// optional plugin flag (mirrors the add-on bundle gate). The create routes
// themselves remain the server authority; this menu is a presentational
// shortcut that only surfaces what the caller can both perform and reach.

import type { Capability } from '@/lib/capabilities';
import { FEATURE_FLAGS } from '@/lib/constants';

export interface CreateAction {
  label: string;
  href: string;
  cap: Capability;
  /** Optional add-on plugin flag. The action shows only when the flag is on. */
  plugin?: string;
}

export const CREATE_ACTIONS: ReadonlyArray<CreateAction> = [
  { label: 'New customer', href: '/crm/customers/new', cap: 'crm.customers.write' },
  { label: 'New quote', href: '/quotes/new', cap: 'quotes.quote.write' },
  { label: 'New project', href: '/projects/new', cap: 'projects.project.write' },
  { label: 'New invoice', href: '/invoicing/invoices/new', cap: 'invoices.write' },
  { label: 'New payment', href: '/invoicing/payments/new', cap: 'payments.write' },
  {
    label: 'New vendor',
    href: '/purchasing/vendors/new',
    cap: 'vendors.vendor.create',
  },
  { label: 'New item', href: '/catalog/items/new', cap: 'items.item.write' },
  {
    label: 'New sales order',
    href: '/copack/orders/new',
    cap: 'copack.order.create',
    plugin: FEATURE_FLAGS.PLUGINS_COPACK_ECOM,
  },
  {
    label: 'New manufacturing run',
    href: '/manufacturing/runs/new',
    cap: 'manufacturing.run.create',
    plugin: FEATURE_FLAGS.PLUGINS_MANUFACTURING,
  },
];

/**
 * Filter create actions to those the caller can both perform (capability held)
 * and reach (plugin entitled). An action without a `plugin` is always
 * entitlement-eligible (a spine create). An absent flag key is treated as off,
 * the same contract useOrgFlags applies.
 */
export function visibleCreateActions(
  actions: ReadonlyArray<CreateAction>,
  can: (cap: Capability) => boolean,
  flags: Record<string, boolean>,
): ReadonlyArray<CreateAction> {
  return actions.filter(
    (action) =>
      can(action.cap) &&
      (action.plugin === undefined || flags[action.plugin] === true),
  );
}
