// three-pl-api bundle entry point.
//
// 3PL commercial / planning layer HTTP surface. Sibling bundle to ops-api
// (which owns 3PL execution: receiving, production, shipments). This bundle
// owns the commercial / planning layer that the 3PL pivot introduces:
// Accounts (+ per-account Rate Card overlay), Job Builders (job_templates
// + lines), Supply Plans (+ lines), Job Runs (+ daily logs + consumed /
// produced lines), Billing Review, and Job Profitability. Implements
// 03-workspace/specs/2026-06-04-3pl-commercial-pivot-and-wms-pillar-plan.md.
//
// LAYOUT (R-W13-DX-01 structural split). The router lives here; handler
// bodies live under handlers/<domain>.ts and the route table in routes.ts,
// mirroring crm-api / finance-api. Shared loaders / probes live in
// handlers/_helpers.ts. The split is purely structural: every handler,
// loader, route path, capability check, idempotency key, and error code is
// byte-for-byte the logic the former single-file index.ts ran.
//
// BUNDLE GATE: plugins.three_pl. Constitutional rule (00-canon):
//   Bundle gate off  -> every route returns 404 NOT_FOUND envelope.
//   Per-route flag   -> 403 FEATURE_DISABLED with details.flag. (Not used here.)
//
// The gate fires BEFORE the route table so even a caller hitting an unknown
// path gets 404. Reads are RLS-only (no read cap, except profitability which
// requires threepl.profitability.read); state-changing routes call requireCap.

import { routes } from './routes.ts';
import { serveBundleWithGate } from '../_shared/bundleGate.ts';
import { FEATURE_FLAGS } from '../_shared/constants.ts';
import { BUNDLE } from './handlers/_helpers.ts';

serveBundleWithGate({
  flagKey: FEATURE_FLAGS.PLUGINS_THREE_PL,
  routes,
  bundle: BUNDLE,
});
