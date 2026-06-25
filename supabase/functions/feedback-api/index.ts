// feedback-api entry point (tenant side). Routes for the in-app beta feedback
// loop: a tenant user files a bug / suggestion / question and threads comments
// with platform staff. Per-route capability checks and idempotency live in the
// handlers; the shared route dispatcher handles CORS, errors, and request-id.

import { route } from '../_shared/route.ts';
import { routes } from './routes.ts';

const BUNDLE = 'feedback-api';

Deno.serve((req) => route(req, routes, { bundle: BUNDLE }));
