// vendors-api bundle.
//
// Routes (table-driven dispatch, see _shared/route.ts):
//   GET    /vendors                              list
//   POST   /vendors                              create
//   GET    /vendors/:id                          read
//   PATCH  /vendors/:id                          update
//   DELETE /vendors/:id                          soft-delete
//
//   GET    /purchase-orders                      list
//   POST   /purchase-orders                      create
//   GET    /purchase-orders/:id                  read
//   PATCH  /purchase-orders/:id                  update
//   POST   /purchase-orders/:id/transition       state transition
//   POST   /purchase-orders/:id/line-items       add line
//   PATCH  /purchase-orders/:id/line-items/:lid  update line
//   DELETE /purchase-orders/:id/line-items/:lid  delete line
//
//   GET    /vendor-bills                         list
//   POST   /vendor-bills                         create
//   GET    /vendor-bills/:id                     read
//   PATCH  /vendor-bills/:id                     update
//   POST   /vendor-bills/:id/transition          state transition
//   POST   /vendor-bills/:id/payments            record payment
//
//   GET    /expenses                             list
//   POST   /expenses                             create
//   GET    /expenses/:id                         read
//   PATCH  /expenses/:id                         update
//   POST   /expenses/:id/transition              state transition
//
//   GET    /expense-categories                   list
//   POST   /expense-categories                   create
//   PATCH  /expense-categories/:id               update
//
// RLS: handlers run under service-role; every query carries explicit
// `.eq('org_id', caller.orgId)` (Pattern A) so cross-tenant reads return
// 200 + [] and writes are scoped.

import { route, type Route } from '../_shared/route.ts';
import { handleVendors } from './handlers/vendors.ts';
import { handlePurchaseOrders } from './handlers/purchase-orders.ts';
import { handleVendorBills } from './handlers/vendor-bills.ts';
import { handleExpenses } from './handlers/expenses.ts';
import { handleExpenseCategories } from './handlers/expense-categories.ts';

const TABLE: Route[] = [
  ...handleVendors(),
  ...handlePurchaseOrders(),
  ...handleVendorBills(),
  ...handleExpenses(),
  ...handleExpenseCategories(),
];

Deno.serve((req: Request) => route(req, TABLE, { bundle: 'vendors-api' }));
