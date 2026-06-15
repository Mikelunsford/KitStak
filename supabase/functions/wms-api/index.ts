// wms-api bundle.
//
// Add-on six (WMS, warehouse execution) HTTP surface. Phase B0 of the WMS
// Body B deepening core (handoff 2026-06-14-wms-bodyb-phase1-handoff.md,
// section "B0. WMS chassis"). Sibling bundle to manufacturing-api; gated on
// plugins.wms, which DEFAULTS OFF (paid add-on, unlike plugins.three_pl).
//
// BUNDLE GATE: plugins.wms. Constitutional rule (AUDIT.md / 00-canon):
//   Bundle gate off  -> every route returns 404 NOT_FOUND envelope.
//   Per-route flag   -> 403 FEATURE_DISABLED with details.flag. (Not used here.)
//
// The gate fires BEFORE the route table so even a caller hitting an unknown
// path gets 404. Callers without an org claim land in the standard
// UNAUTHORIZED / NO_ACTIVE_ORG envelopes; we only reach the flag read once
// the caller resolves.
//
// At B0 the route table is EMPTY: this phase stands up the gated chassis with
// no domain tables, caps, or routes. Locations (B1), the stock-movement bin
// dimension (B2), directed putaway (B3), and lots (B4) add the routes per
// phase, mirroring the manufacturing-api route-table shape (parent CRUD,
// FSM transitions, line items) and pulling in the handler helpers
// (admin, parseBody, parseUuidParam, respondWithIdempotency, created,
// requireCap, requireCaller, assertRefInOrg, nextDocNumber, ApiError, ok,
// internalError) as each route lands.

import { type Route } from '../_shared/route.ts';
import { serveBundleWithGate } from '../_shared/bundleGate.ts';
import { FEATURE_FLAGS } from '../_shared/constants.ts';

const BUNDLE = 'wms-api';

// ---------------------------------------------------------------------------
// Route table. Empty at B0; routes land per phase (B1 through B4).
// ---------------------------------------------------------------------------

const TABLE: Route[] = [];

// ---------------------------------------------------------------------------
// Bundle-level dispatcher: gate on plugins.wms before any route runs.
// WMS is a single add-on, so use `flagKey` (one flag), not `flagKeys`.
// Shared with ops-api, quotes-api, projects-api, inventory-api,
// manufacturing-api via _shared/bundleGate.ts. Exactly one of
// flagKey / flagKeys is required or the gate fails closed to 404.
// ---------------------------------------------------------------------------

serveBundleWithGate({
  flagKey: FEATURE_FLAGS.PLUGINS_WMS,
  routes: TABLE,
  bundle: BUNDLE,
});
