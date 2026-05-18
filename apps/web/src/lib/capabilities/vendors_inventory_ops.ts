// Side-car capability canon for vendors + inventory + ops.
// Byte-identical pair: apps/web/src/lib/capabilities/vendors_inventory_ops.ts.
// Drift is a release blocker.
//
// Domain prefixes:
//   vendors.*, purchase_orders.*, vendor_bills.*, expenses.*, warehouses.*,
//   stock.*, receiving.* (incl. receiving.receive),
//   production.* (incl. production.start, production.complete),
//   shipments.* (incl. shipments.ship).
//
// Handler-side enforcement: requireCapAny(caller, [CAP]). The base
// supabase/functions/_shared/capabilities.ts Capability union is not edited;
// this side-car carries its own union and role table.

export type RoleCode =
  | 'org_owner'
  | 'org_admin'
  | 'sales'
  | 'ops'
  | 'accounting'
  | 'viewer'
  | 'customer_user'
  | 'vendor_user';

export type VendorsInventoryOpsCapability =
  | 'vendors.vendor.read'
  | 'vendors.vendor.create'
  | 'vendors.vendor.update'
  | 'vendors.vendor.delete'
  | 'purchase_orders.purchase_order.read'
  | 'purchase_orders.purchase_order.create'
  | 'purchase_orders.purchase_order.update'
  | 'purchase_orders.purchase_order.transition'
  | 'purchase_orders.line_item.write'
  | 'vendor_bills.vendor_bill.read'
  | 'vendor_bills.vendor_bill.create'
  | 'vendor_bills.vendor_bill.update'
  | 'vendor_bills.vendor_bill.transition'
  | 'vendor_bills.payment.write'
  | 'expenses.expense.read'
  | 'expenses.expense.create'
  | 'expenses.expense.update'
  | 'expenses.expense.submit'
  | 'expenses.expense.approve'
  | 'expenses.expense.pay'
  | 'expenses.expense.reject'
  | 'expenses.category.write'
  | 'warehouses.warehouse.read'
  | 'warehouses.warehouse.create'
  | 'warehouses.warehouse.update'
  | 'warehouses.warehouse.delete'
  | 'stock.level.read'
  | 'stock.movement.read'
  | 'stock.bom.read'
  | 'stock.bom.write'
  | 'receiving.order.read'
  | 'receiving.order.create'
  | 'receiving.order.update'
  | 'receiving.receive'
  | 'production.run.read'
  | 'production.run.create'
  | 'production.run.update'
  | 'production.start'
  | 'production.complete'
  | 'shipments.shipment.read'
  | 'shipments.shipment.create'
  | 'shipments.shipment.update'
  | 'shipments.ship';

const OWNER_ADMIN_FULL: ReadonlyArray<VendorsInventoryOpsCapability> = [
  'vendors.vendor.read',
  'vendors.vendor.create',
  'vendors.vendor.update',
  'vendors.vendor.delete',
  'purchase_orders.purchase_order.read',
  'purchase_orders.purchase_order.create',
  'purchase_orders.purchase_order.update',
  'purchase_orders.purchase_order.transition',
  'purchase_orders.line_item.write',
  'vendor_bills.vendor_bill.read',
  'vendor_bills.vendor_bill.create',
  'vendor_bills.vendor_bill.update',
  'vendor_bills.vendor_bill.transition',
  'vendor_bills.payment.write',
  'expenses.expense.read',
  'expenses.expense.create',
  'expenses.expense.update',
  'expenses.expense.submit',
  'expenses.expense.approve',
  'expenses.expense.pay',
  'expenses.expense.reject',
  'expenses.category.write',
  'warehouses.warehouse.read',
  'warehouses.warehouse.create',
  'warehouses.warehouse.update',
  'warehouses.warehouse.delete',
  'stock.level.read',
  'stock.movement.read',
  'stock.bom.read',
  'stock.bom.write',
  'receiving.order.read',
  'receiving.order.create',
  'receiving.order.update',
  'receiving.receive',
  'production.run.read',
  'production.run.create',
  'production.run.update',
  'production.start',
  'production.complete',
  'shipments.shipment.read',
  'shipments.shipment.create',
  'shipments.shipment.update',
  'shipments.ship',
];

const OPS_CAPS: ReadonlyArray<VendorsInventoryOpsCapability> = [
  'vendors.vendor.read',
  'vendors.vendor.create',
  'vendors.vendor.update',
  'purchase_orders.purchase_order.read',
  'purchase_orders.purchase_order.create',
  'purchase_orders.purchase_order.update',
  'purchase_orders.purchase_order.transition',
  'purchase_orders.line_item.write',
  'vendor_bills.vendor_bill.read',
  'expenses.expense.read',
  'expenses.expense.create',
  'expenses.expense.submit',
  'warehouses.warehouse.read',
  'warehouses.warehouse.create',
  'warehouses.warehouse.update',
  'stock.level.read',
  'stock.movement.read',
  'stock.bom.read',
  'stock.bom.write',
  'receiving.order.read',
  'receiving.order.create',
  'receiving.order.update',
  'receiving.receive',
  'production.run.read',
  'production.run.create',
  'production.run.update',
  'production.start',
  'production.complete',
  'shipments.shipment.read',
  'shipments.shipment.create',
  'shipments.shipment.update',
  'shipments.ship',
];

const ACCOUNTING_CAPS: ReadonlyArray<VendorsInventoryOpsCapability> = [
  'vendors.vendor.read',
  'vendors.vendor.create',
  'vendors.vendor.update',
  'purchase_orders.purchase_order.read',
  'vendor_bills.vendor_bill.read',
  'vendor_bills.vendor_bill.create',
  'vendor_bills.vendor_bill.update',
  'vendor_bills.vendor_bill.transition',
  'vendor_bills.payment.write',
  'expenses.expense.read',
  'expenses.expense.create',
  'expenses.expense.update',
  'expenses.expense.approve',
  'expenses.expense.pay',
  'expenses.expense.reject',
  'expenses.category.write',
  'warehouses.warehouse.read',
  'stock.level.read',
  'stock.movement.read',
  'receiving.order.read',
  'production.run.read',
  'shipments.shipment.read',
];

const SALES_READ: ReadonlyArray<VendorsInventoryOpsCapability> = [
  'vendors.vendor.read',
  'purchase_orders.purchase_order.read',
  'warehouses.warehouse.read',
  'stock.level.read',
  'shipments.shipment.read',
];

const VIEWER_CAPS: ReadonlyArray<VendorsInventoryOpsCapability> = [
  'vendors.vendor.read',
  'purchase_orders.purchase_order.read',
  'vendor_bills.vendor_bill.read',
  'expenses.expense.read',
  'warehouses.warehouse.read',
  'stock.level.read',
  'stock.movement.read',
  'stock.bom.read',
  'receiving.order.read',
  'production.run.read',
  'shipments.shipment.read',
];

const VENDOR_PORTAL_CAPS: ReadonlyArray<VendorsInventoryOpsCapability> = [
  'purchase_orders.purchase_order.read',
  'vendor_bills.vendor_bill.read',
];

export const VENDORS_INVENTORY_OPS_CAPS_BY_ROLE: Readonly<
  Record<RoleCode, ReadonlyArray<VendorsInventoryOpsCapability>>
> = {
  org_owner:     OWNER_ADMIN_FULL,
  org_admin:     OWNER_ADMIN_FULL,
  sales:         SALES_READ,
  ops:           OPS_CAPS,
  accounting:    ACCOUNTING_CAPS,
  viewer:        VIEWER_CAPS,
  customer_user: [],
  vendor_user:   VENDOR_PORTAL_CAPS,
};

export function hasVendorsInventoryOpsCap(
  role: RoleCode,
  cap: VendorsInventoryOpsCapability,
): boolean {
  return VENDORS_INVENTORY_OPS_CAPS_BY_ROLE[role].includes(cap);
}
