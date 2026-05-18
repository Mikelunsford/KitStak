// crm-api route table. One entry per HTTP verb plus path. The route
// dispatcher matches method + path and falls through to METHOD_NOT_ALLOWED
// or NOT_FOUND per the architecture rules.

import type { Route } from '../_shared/route.ts';
import { ok } from '../_shared/responses.ts';

import {
  createCustomer,
  deleteCustomer,
  getCustomer,
  listCustomers,
  patchCustomer,
} from './handlers/customers.ts';
import {
  createContact,
  deleteContact,
  getContact,
  listContacts,
  patchContact,
} from './handlers/contacts.ts';
import {
  createActivity,
  getActivity,
  listActivities,
  patchActivity,
} from './handlers/activities.ts';
import {
  convertLead,
  createLead,
  getLead,
  listLeads,
  patchLead,
} from './handlers/leads.ts';
import {
  createOpportunity,
  getOpportunity,
  listOpportunities,
  patchOpportunity,
  transitionOpportunityStage,
} from './handlers/opportunities.ts';

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/',
    handler: () => ok({ ok: true, bundle: 'crm-api' }),
  },

  // Customers
  { method: 'GET',    path: '/customers',         handler: listCustomers },
  { method: 'POST',   path: '/customers',         handler: createCustomer },
  { method: 'GET',    path: '/customers/:id',     handler: getCustomer },
  { method: 'PATCH',  path: '/customers/:id',     handler: patchCustomer },
  { method: 'DELETE', path: '/customers/:id',     handler: deleteCustomer },

  // Contacts
  { method: 'GET',    path: '/contacts',          handler: listContacts },
  { method: 'POST',   path: '/contacts',          handler: createContact },
  { method: 'GET',    path: '/contacts/:id',      handler: getContact },
  { method: 'PATCH',  path: '/contacts/:id',      handler: patchContact },
  { method: 'DELETE', path: '/contacts/:id',      handler: deleteContact },

  // Activities
  { method: 'GET',    path: '/activities',        handler: listActivities },
  { method: 'POST',   path: '/activities',        handler: createActivity },
  { method: 'GET',    path: '/activities/:id',    handler: getActivity },
  { method: 'PATCH',  path: '/activities/:id',    handler: patchActivity },

  // Leads
  { method: 'GET',    path: '/leads',             handler: listLeads },
  { method: 'POST',   path: '/leads',             handler: createLead },
  { method: 'GET',    path: '/leads/:id',         handler: getLead },
  { method: 'PATCH',  path: '/leads/:id',         handler: patchLead },
  { method: 'POST',   path: '/leads/:id/convert', handler: convertLead },

  // Opportunities
  { method: 'GET',    path: '/opportunities',                handler: listOpportunities },
  { method: 'POST',   path: '/opportunities',                handler: createOpportunity },
  { method: 'GET',    path: '/opportunities/:id',            handler: getOpportunity },
  { method: 'PATCH',  path: '/opportunities/:id',            handler: patchOpportunity },
  { method: 'POST',   path: '/opportunities/:id/transition', handler: transitionOpportunityStage },
];
