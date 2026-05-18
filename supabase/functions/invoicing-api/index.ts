// invoicing-api entry point. Routes for invoices, line items, payments, and
// credit notes. Per-route capability checks and idempotency live in the
// handlers; the shared route dispatcher handles CORS, errors, and request-id.

import { route } from '../_shared/route.ts';
import { routes } from './routes.ts';

const BUNDLE = 'invoicing-api';

Deno.serve((req) => route(req, routes, { bundle: BUNDLE }));
