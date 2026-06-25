// feedback-api route table (tenant side). Internal beta feedback / support
// ticketing. The route dispatcher matches method + path and falls through to
// METHOD_NOT_ALLOWED or NOT_FOUND per the architecture rules.

import type { Route } from '../_shared/route.ts';
import { ok } from '../_shared/responses.ts';

import {
  createTicket,
  createTicketComment,
  getTicket,
  listTicketComments,
  listTickets,
} from './handlers/tickets.ts';

export const routes: Route[] = [
  { method: 'GET', path: '/', handler: () => ok({ ok: true, bundle: 'feedback-api' }) },

  // Tickets
  { method: 'GET',  path: '/tickets',              handler: listTickets },
  { method: 'POST', path: '/tickets',              handler: createTicket },
  { method: 'GET',  path: '/tickets/:id',          handler: getTicket },

  // Ticket comments (the two-way thread; tenants see non-internal only)
  { method: 'GET',  path: '/tickets/:id/comments', handler: listTicketComments },
  { method: 'POST', path: '/tickets/:id/comments', handler: createTicketComment },
];
