// Spine plus add-ons re-route: deep-link redirects.
//
// The white paper V2 reframes Kitstak as one spine plus composable add-ons.
// Spine and shared-building-block surfaces that used to live under the
// plugin-gated /3pl-operations/* namespace move to neutral, always-ungated
// roots. Every moved path keeps a redirect entry at its OLD path so existing
// bookmarks, emailed links, and search results still land on the new home.
//
// One generic component serves every moved pattern: it reads the current
// location, rewrites the leading prefix per REDIRECT_PREFIX_MAP, and issues a
// replace navigation that preserves the dynamic segments, query string, and
// hash. This supersedes the per-path LegacyProductionRedirect precedent
// (which used a static target and dropped search/hash).
//
// Redirect route entries set `isRedirect: true` so inferPluginForPath leaves
// them ungated (see routes.ts). Constitutional posture: SPA only, no API or
// migration change. Navigate is already react-router-dom (zero new dependency).

import { Navigate, useLocation } from 'react-router-dom';

/**
 * Old base prefix to new base prefix pairs. Order does not matter; the
 * resolver picks the longest matching old prefix. Each entry maps a moved
 * domain's old /3pl-operations root to its new spine home. Sub-paths
 * (/new, /:id, /:id/edit, /:id/send) are handled by suffix preservation in
 * rewriteSpinePath, so only the base prefix is listed here.
 */
export const REDIRECT_PREFIX_MAP: ReadonlyArray<readonly [string, string]> = [
  ['/3pl-operations/quotes', '/quotes'],
  ['/3pl-operations/projects', '/projects'],
  ['/3pl-operations/vendors', '/purchasing/vendors'],
  ['/3pl-operations/purchase-orders', '/purchasing/purchase-orders'],
  ['/3pl-operations/vendor-bills', '/purchasing/vendor-bills'],
  ['/3pl-operations/expenses', '/purchasing/expenses'],
  ['/3pl-operations/items', '/catalog/items'],
  ['/3pl-operations/boms', '/catalog/boms'],
  ['/3pl-operations/vas', '/catalog/vas'],
  ['/3pl-operations/warehouses', '/inventory/warehouses'],
  ['/3pl-operations/stock', '/inventory/stock'],
  ['/3pl-operations/sales-config', '/settings/sales-config'],
  ['/3pl-operations/payments', '/invoicing/payments'],
  ['/3pl-operations/credit-notes', '/invoicing/credit-notes'],
];

/**
 * Rewrite a legacy pathname to its new spine home, or return null when no
 * mapped prefix applies (the path stays where it is). Matching is on segment
 * boundaries (exact, or prefix followed by a slash) so /quotes never captures
 * a sibling like /quotesextra, and the longest matching prefix wins.
 */
export function rewriteSpinePath(pathname: string): string | null {
  let best: readonly [string, string] | null = null;
  for (const pair of REDIRECT_PREFIX_MAP) {
    const from = pair[0];
    const isMatch = pathname === from || pathname.startsWith(`${from}/`);
    if (isMatch && (best === null || from.length > best[0].length)) {
      best = pair;
    }
  }
  if (best === null) return null;
  return best[1] + pathname.slice(best[0].length);
}

/**
 * Minimal location shape the resolver needs. Mirrors the fields of
 * react-router's location that we forward to Navigate.
 */
export interface SpineRedirectLocation {
  pathname: string;
  search: string;
  hash: string;
}

/**
 * Resolve the Navigate target for a legacy location, preserving query and
 * hash. When no prefix matches, the pathname is returned unchanged (the
 * redirect becomes a no-op rather than throwing). Pure, so it carries the
 * unit coverage without a router context.
 */
export function resolveSpineRedirect(
  location: SpineRedirectLocation,
): SpineRedirectLocation {
  const rewritten = rewriteSpinePath(location.pathname);
  return {
    pathname: rewritten ?? location.pathname,
    search: location.search,
    hash: location.hash,
  };
}

/**
 * Generic redirect element for every moved spine path. Registered once per
 * old path pattern in routes.ts with `isRedirect: true`.
 */
export function SpineMoveRedirect() {
  const location = useLocation();
  return <Navigate to={resolveSpineRedirect(location)} replace />;
}
