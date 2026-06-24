// feedback-admin-api route table (platform-staff, cross-tenant). The route
// dispatcher matches method + path and falls through to METHOD_NOT_ALLOWED or
// NOT_FOUND per the architecture rules. Every handler except GET / and GET /me
// gates on assertPlatformStaff inside the handler.

import type { Route } from '../_shared/route.ts';
import { ok } from '../_shared/responses.ts';

import {
  createTicketComment,
  getMe,
  getTicket,
  listTicketComments,
  listTickets,
  patchTicket,
} from './handlers/tickets.ts';

export const routes: Route[] = [
  { method: 'GET', path: '/',   handler: () => ok({ ok: true, bundle: 'feedback-admin-api' }) },
  { method: 'GET', path: '/me', handler: getMe },

  // Cross-tenant ticket inbox (platform-staff gated in each handler)
  { method: 'GET',   path: '/tickets',              handler: listTickets },
  { method: 'GET',   path: '/tickets/:id',          handler: getTicket },
  { method: 'PATCH', path: '/tickets/:id',          handler: patchTicket },

  // Comments (staff sees ALL comments, including internal notes)
  { method: 'GET',   path: '/tickets/:id/comments', handler: listTicketComments },
  { method: 'POST',  path: '/tickets/:id/comments', handler: createTicketComment },
];
