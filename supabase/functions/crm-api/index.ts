// crm-api entry point. Routes for customers, contacts, activities, leads,
// opportunities. Uses the shared route dispatcher; per-route capability
// checks and idempotency live in the handlers.

import { route } from '../_shared/route.ts';
import { routes } from './routes.ts';

const BUNDLE = 'crm-api';

Deno.serve((req) => route(req, routes, { bundle: BUNDLE }));
