// finance-api entry point. Routes for COA, journal entries (per-route
// flag-gated), and period close. Per-route capability checks and
// idempotency live in the handlers.

import { route } from '../_shared/route.ts';
import { routes } from './routes.ts';

const BUNDLE = 'finance-api';

Deno.serve((req) => route(req, routes, { bundle: BUNDLE }));
