// invoicing-api route table. Invoices, line items, payments, credit notes.
// The route dispatcher matches method + path and falls through to
// METHOD_NOT_ALLOWED or NOT_FOUND per the architecture rules.

import type { Route } from '../_shared/route.ts';
import { ok } from '../_shared/responses.ts';

import {
  cancelInvoice,
  createInvoice,
  deleteInvoice,
  getInvoice,
  getInvoicePdf,
  listInvoices,
  patchInvoice,
  sendInvoice,
  transitionInvoice,
} from './handlers/invoices.ts';
import {
  createLineItem,
  deleteLineItem,
  listLineItems,
  patchLineItem,
} from './handlers/invoice_line_items.ts';
import {
  applyPayment,
  createPayment,
  deletePayment,
  getPayment,
  listPayments,
  patchPayment,
} from './handlers/payments.ts';
import {
  applyCreditNote,
  createCreditNote,
  deleteCreditNote,
  getCreditNote,
  listCreditNotes,
  patchCreditNote,
} from './handlers/credit_notes.ts';

export const routes: Route[] = [
  { method: 'GET', path: '/', handler: () => ok({ ok: true, bundle: 'invoicing-api' }) },

  // Invoices
  { method: 'GET',    path: '/invoices',                handler: listInvoices },
  { method: 'POST',   path: '/invoices',                handler: createInvoice },
  { method: 'GET',    path: '/invoices/:id',            handler: getInvoice },
  { method: 'PATCH',  path: '/invoices/:id',            handler: patchInvoice },
  { method: 'DELETE', path: '/invoices/:id',            handler: deleteInvoice },
  { method: 'POST',   path: '/invoices/:id/send',       handler: sendInvoice },
  { method: 'POST',   path: '/invoices/:id/cancel',     handler: cancelInvoice },
  { method: 'POST',   path: '/invoices/:id/transition', handler: transitionInvoice },
  { method: 'GET',    path: '/invoices/:id/pdf',        handler: getInvoicePdf },

  // Invoice line items
  { method: 'GET',    path: '/invoices/:id/line-items',     handler: listLineItems },
  { method: 'POST',   path: '/invoices/:id/line-items',     handler: createLineItem },
  { method: 'PATCH',  path: '/invoice-line-items/:line_id', handler: patchLineItem },
  { method: 'DELETE', path: '/invoice-line-items/:line_id', handler: deleteLineItem },

  // Payments
  { method: 'GET',    path: '/payments',           handler: listPayments },
  { method: 'POST',   path: '/payments',           handler: createPayment },
  { method: 'GET',    path: '/payments/:id',       handler: getPayment },
  { method: 'PATCH',  path: '/payments/:id',       handler: patchPayment },
  { method: 'DELETE', path: '/payments/:id',       handler: deletePayment },
  { method: 'POST',   path: '/payments/:id/apply', handler: applyPayment },

  // Credit notes
  { method: 'GET',    path: '/credit-notes',           handler: listCreditNotes },
  { method: 'POST',   path: '/credit-notes',           handler: createCreditNote },
  { method: 'GET',    path: '/credit-notes/:id',       handler: getCreditNote },
  { method: 'PATCH',  path: '/credit-notes/:id',       handler: patchCreditNote },
  { method: 'DELETE', path: '/credit-notes/:id',       handler: deleteCreditNote },
  { method: 'POST',   path: '/credit-notes/:id/apply', handler: applyCreditNote },
];
