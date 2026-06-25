// feedback-admin-api entry point (platform-staff, CROSS-TENANT). The staff
// surface for the in-app feedback loop: a Kitstak operator triages, replies to,
// and resolves support tickets across every tenant. Membership is gated by the
// platform_staff allowlist inside each handler (assertPlatformStaff); the
// shared route dispatcher handles CORS, errors, and request-id.

import { route } from '../_shared/route.ts';
import { routes } from './routes.ts';

const BUNDLE = 'feedback-admin-api';

Deno.serve((req) => route(req, routes, { bundle: BUNDLE }));
