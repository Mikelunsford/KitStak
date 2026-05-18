# vendors-api

Bundle for vendors, purchase orders, vendor bills, and expenses. Standard envelope: `{ data, meta }` on 2xx, `{ error: { code, message, details } }` on errors. Every non-GET requires `Idempotency-Key: <uuid v4>`. RLS Pattern A (`org_id = current_org_id()`) on every parent; Pattern B on child rows.

## Resources

### Vendors

- `GET /vendors-api/vendors` cap `vendors.vendor.read`
- `POST /vendors-api/vendors` cap `vendors.vendor.create`
- `GET /vendors-api/vendors/:id` cap `vendors.vendor.read`
- `PATCH /vendors-api/vendors/:id` cap `vendors.vendor.update`
- `DELETE /vendors-api/vendors/:id` cap `vendors.vendor.delete` (soft-delete via `deleted_at`)

### Purchase orders + line items

- `GET /vendors-api/purchase-orders` cap `purchase_orders.purchase_order.read`
- `POST /vendors-api/purchase-orders` cap `purchase_orders.purchase_order.create`
- `GET /vendors-api/purchase-orders/:id` cap `purchase_orders.purchase_order.read`
- `PATCH /vendors-api/purchase-orders/:id` cap `purchase_orders.purchase_order.update`
- `POST /vendors-api/purchase-orders/:id/transition` cap `purchase_orders.purchase_order.transition`
  - Body: `{ to: PurchaseOrderStatus }`. FSM enforced. Returns `409 STATE_CONFLICT` on illegal transition.
- `GET /vendors-api/purchase-orders/:id/line-items` cap `purchase_orders.purchase_order.read`
- `POST /vendors-api/purchase-orders/:id/line-items` cap `purchase_orders.line_item.write`
- `PATCH /vendors-api/purchase-orders/:id/line-items/:lid` cap `purchase_orders.line_item.write`
- `DELETE /vendors-api/purchase-orders/:id/line-items/:lid` cap `purchase_orders.line_item.write`

Parent `subtotal_cents`, `tax_cents`, `total_cents` are recomputed from `po_line_items` via the `recompute_purchase_order_totals` trigger function.

### Vendor bills + payments

- `GET /vendors-api/vendor-bills` cap `vendor_bills.vendor_bill.read`
- `POST /vendors-api/vendor-bills` cap `vendor_bills.vendor_bill.create`
- `GET /vendors-api/vendor-bills/:id` cap `vendor_bills.vendor_bill.read`
- `PATCH /vendors-api/vendor-bills/:id` cap `vendor_bills.vendor_bill.update`
- `POST /vendors-api/vendor-bills/:id/transition` cap `vendor_bills.vendor_bill.transition`
- `GET /vendors-api/vendor-bills/:id/payments` cap `vendor_bills.vendor_bill.read`
- `POST /vendors-api/vendor-bills/:id/payments` cap `vendor_bills.payment.write`

`balance_cents` is a `GENERATED ALWAYS AS (total_cents - paid_cents) STORED` column. `paid_cents` is maintained from `vendor_bill_payments` via the `recompute_vendor_bill_paid` trigger.

### Expenses + categories

- `GET /vendors-api/expenses` cap `expenses.expense.read`
- `POST /vendors-api/expenses` cap `expenses.expense.create`
- `GET /vendors-api/expenses/:id` cap `expenses.expense.read`
- `PATCH /vendors-api/expenses/:id` cap `expenses.expense.update`
- `POST /vendors-api/expenses/:id/transition` cap depends on `to`:
  - `submitted` -> `expenses.expense.submit`
  - `approved`  -> `expenses.expense.approve`
  - `paid` / `reimbursed` -> `expenses.expense.pay`
  - `rejected`  -> `expenses.expense.reject`

- `GET /vendors-api/expense-categories` cap `expenses.expense.read`
- `POST /vendors-api/expense-categories` cap `expenses.category.write`
- `PATCH /vendors-api/expense-categories/:id` cap `expenses.category.write`

## State machines

See `_shared/workflow/vendors_inventory_ops.ts` for the canonical FSMs:
- `PURCHASE_ORDER_FSM` 7 states.
- `VENDOR_BILL_FSM` 7 states.
- `EXPENSE_FSM` 6 states.

## Auto journal entries

Triggers in migration 0029 fire on state transitions:
- `vendor_bills` -> `approved` debits expense, credits AP.
- `vendor_bills` -> `paid` / `partial_paid` debits AP, credits cash.
- `expenses` -> `paid` / `reimbursed` debits expense, credits cash.

All three are EXISTS-guarded on `public.journal_entries` (finance bundle ships the table later) and gated by per-org flag `finance.journal_entries.enabled`. No-op until both are present.
