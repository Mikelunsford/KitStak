import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { ApiError } from '@/lib/apiClient';
import { ERROR_CODES } from '@/lib/constants';

/**
 * RequireFlag. react-router v6 outlet guard for per-route feature flag
 * gating. Wraps a subtree; when the per-route flag is off the BE returns
 * `403 FEATURE_DISABLED { flag }` and consumer components can throw that
 * error up to this guard, which redirects to /feature-unavailable.
 *
 * Per 00-canon/01-architecture.md: bundle-off returns 404 (handled
 * server-side and via 404 routing); per-route-off returns 403 and ends
 * here.
 *
 * Wave 1 stub: the real org_feature_flags fetch ships in Wave 2 with
 * useOrgFlags(). For Wave 1 this guard renders <Outlet/> unconditionally
 * but exports a helper to check ApiError for FEATURE_DISABLED so screens
 * built in Wave 1 can wire the redirect themselves.
 */

export interface RequireFlagProps {
  flag: string;
}

export function isFeatureDisabledError(err: unknown, flag?: string): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.code !== ERROR_CODES.FEATURE_DISABLED) return false;
  if (!flag) return true;
  return err.details?.['flag'] === flag;
}

export function RequireFlag({ flag }: RequireFlagProps) {
  const location = useLocation();

  // TODO(Wave 2 Agent A): replace fail-open with useOrgFlags()-driven
  // gating. For Wave 1 we render the outlet and rely on the BE 403 to
  // bounce callers via the FeatureUnavailablePage error path.
  const flagsLoaded = true;
  const flagOn = true;

  if (!flagsLoaded) return null;

  if (!flagOn) {
    return (
      <Navigate
        to={`/feature-unavailable?flag=${encodeURIComponent(flag)}`}
        replace
        state={{ from: location.pathname, flag }}
      />
    );
  }

  return <Outlet />;
}
