// BNEW-2 (2026-05-22 v2 smoke walk): the legacy production-runs surface
// at /3pl-operations/production rendered an older form (raw UUID inputs,
// no warehouse dropdown, no auto-number, no item picker). The canonical
// surface is /manufacturing/runs, built on the manufacturing-api Edge
// Function (Path A5). PR #112 (UX-Q1) accidentally surfaced both routes
// in MAKE mode, exposing the regressed form to operators.
//
// Fix shape: the sidebar entry is removed (see sidebarModes.ts) and the
// two legacy routes (/3pl-operations/production and /new) stay registered
// as <Navigate replace> redirects so deep links and bookmarks land on the
// canonical surface instead of 404'ing.
//
// Follow-up: F-Wave9-LEGACY-PRODUCTION-ROUTE-RETIRE-01 — drop the redirect
// once we're confident no live bookmarks land on it.
//
// Constitutional posture: SPA only, no migration, no API change. <Navigate>
// is already react-router-dom (zero new dependency).

import { Navigate } from 'react-router-dom';

/**
 * Redirect for the legacy production-runs list route
 * (/3pl-operations/production). Lands the operator on /manufacturing/runs.
 */
export function LegacyProductionListRedirect() {
  return <Navigate to="/manufacturing/runs" replace />;
}

/**
 * Redirect for the legacy production-run create route
 * (/3pl-operations/production/new). Lands the operator on
 * /manufacturing/runs/new, which is the canonical create surface with the
 * warehouse dropdown, auto-numbering, and item picker.
 */
export function LegacyProductionCreateRedirect() {
  return <Navigate to="/manufacturing/runs/new" replace />;
}
