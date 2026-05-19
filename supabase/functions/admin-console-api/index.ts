// admin-console-api: platform-admin surface. Deferred behind
// `platform_admin.enabled` per the AUDIT decisions log.
//
// Bundle-level gate: when the flag is off for the caller's org, the entire
// bundle returns 404 NOT_FOUND so the surface is invisible. This is the
// constitutional pattern for plugin-style gates (cf. plugins.three_pl and the
// five pillar bundles). A 403 where 404 is required is a release blocker.
//
// Wave 2 ships a stub: empty handlers behind the bundle gate. Once the flag
// is enabled and MFA is configured, the per-route handlers will land in a
// subsequent wave (organisation listing, impersonation, audit ledger).
//
// MFA gate: when the flag is on, every state-changing route additionally
// calls requireMfaVerified on the caller. Documented but not exercised
// today since no state-changing route exists yet.

import { route, type RouteCtx } from '../_shared/route.ts';
import { getFlag } from '../_shared/feature-flags.ts';
import { readCallerContext } from '../_shared/tenant.ts';
import { ApiError, ok } from '../_shared/responses.ts';
import { requireMfaVerified } from '../_shared/mfa.ts';
import { ERROR_CODES, FEATURE_FLAGS } from '../_shared/constants.ts';
import {
  hasIdentityCap,
  type IdentityCapability,
} from '../_shared/capabilities/identity.ts';
import type { Caller } from '../_shared/tenant.ts';

const BUNDLE = 'admin-console-api';
const PLATFORM_ADMIN_FLAG = FEATURE_FLAGS.PLATFORM_ADMIN_ENABLED;

function requireIdentityCap(caller: Caller, cap: IdentityCapability): void {
  if (hasIdentityCap(caller.role, cap)) return;
  throw new ApiError(ERROR_CODES.FORBIDDEN, 403, `caller lacks capability: ${cap}`);
}

/**
 * Bundle-level gate. Resolves the caller's org (if any), checks the
 * platform_admin.enabled flag, and throws NOT_FOUND when the flag is off so
 * the surface is hidden entirely. Unauthenticated callers are treated as
 * flag-off; we never leak that the bundle exists.
 */
async function assertBundleEnabled(req: Request): Promise<Caller> {
  const ctx = readCallerContext(req);
  if (!ctx.userId || !ctx.orgId || !ctx.role) {
    // Hide the bundle entirely from anonymous callers. 404 is intentional.
    throw new ApiError(ERROR_CODES.NOT_FOUND, 404, 'Not found.');
  }
  const { enabled } = await getFlag(ctx.orgId, PLATFORM_ADMIN_FLAG);
  if (!enabled) {
    throw new ApiError(ERROR_CODES.NOT_FOUND, 404, 'Not found.');
  }
  return { userId: ctx.userId, orgId: ctx.orgId, role: ctx.role };
}

async function listOrgs(ctx: RouteCtx): Promise<Response> {
  const caller = await assertBundleEnabled(ctx.req);
  requireIdentityCap(caller, 'admin.orgs.read');
  // Wave 2 stub: schema lands in a later wave alongside platform-admin
  // tooling. Empty page so the SPA can render an empty-state.
  return ok({ items: [], next_cursor: null });
}

async function impersonateOrg(ctx: RouteCtx): Promise<Response> {
  const caller = await assertBundleEnabled(ctx.req);
  requireIdentityCap(caller, 'admin.orgs.impersonate');
  await requireMfaVerified(caller, ctx.req);
  // Wave 2 stub: schema lands later. Echoing back NOT_IMPLEMENTED is the
  // honest signal; the SPA never reaches here unless an operator manually
  // crafts the request.
  throw new ApiError(
    'NOT_IMPLEMENTED',
    501,
    'Platform-admin impersonation is not yet wired.',
  );
}

async function readAuditAcrossOrgs(ctx: RouteCtx): Promise<Response> {
  const caller = await assertBundleEnabled(ctx.req);
  requireIdentityCap(caller, 'admin.audit.read');
  await requireMfaVerified(caller, ctx.req);
  return ok({ items: [], next_cursor: null });
}

Deno.serve((req: Request) =>
  route(
    req,
    [
      { method: 'GET',  path: '/orgs',            handler: listOrgs },
      { method: 'POST', path: '/orgs/impersonate', handler: impersonateOrg },
      { method: 'GET',  path: '/audit',           handler: readAuditAcrossOrgs },
    ],
    { bundle: BUNDLE },
  ),
);
