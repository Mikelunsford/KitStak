// Tenancy helpers.
//
// `requireCaller(req)` decodes the Authorization bearer JWT and returns the
// caller's identity plus the active org claim. The Supabase gateway verifies
// the signature when `verify_jwt = true`; here we only extract claims.
//
// JWT claim shape (per REBRAND-MAP.md §8 and migration 0001's
// `current_org_id()` / `current_user_role()` helpers):
//   app_metadata.kitstak_org_id    uuid
//   app_metadata.kitstak_org_role  text (RoleCode)
//
// RLS is the authority on row visibility. This helper is the authority on
// "who is calling and which org are they acting in" for handler logic that
// runs above the row. A missing JWT throws UNAUTHORIZED; a present JWT
// without an org claim throws NO_ACTIVE_ORG so the SPA can route to org-pick.

import { ApiError } from './responses.ts';
import { ERROR_CODES, HTTP_HEADERS } from './constants.ts';
import type { RoleCode } from './capabilities.ts';

export interface Caller {
  userId: string;
  orgId: string;
  role: RoleCode;
  sessionId?: string;
}

export interface CallerContext {
  userId: string | null;
  orgId: string | null;
  role: RoleCode | null;
  sessionId?: string;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const json = atob(b64 + pad);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractToken(req: Request): string | null {
  const h = req.headers.get(HTTP_HEADERS.AUTHORIZATION);
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1] : null;
}

/**
 * Pull the org_id out of a JWT, or null if absent / malformed.
 * Exported for the rare case a handler wants the claim without throwing.
 */
export function currentOrgIdFromJwt(jwt: string): string | null {
  const payload = decodeJwtPayload(jwt);
  if (!payload) return null;
  const meta =
    (payload.app_metadata as Record<string, unknown> | undefined) ?? {};
  const v = meta.kitstak_org_id;
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Lenient context resolver. Returns null fields when JWT or claims are
 * absent. Suitable for health endpoints and other surfaces that must respond
 * without a caller.
 */
export function readCallerContext(req: Request): CallerContext {
  const token = extractToken(req);
  if (!token) return { userId: null, orgId: null, role: null };
  const payload = decodeJwtPayload(token);
  if (!payload) return { userId: null, orgId: null, role: null };

  const userId =
    typeof payload.sub === 'string' ? (payload.sub as string) : null;
  const meta =
    (payload.app_metadata as Record<string, unknown> | undefined) ?? {};
  const orgId =
    typeof meta.kitstak_org_id === 'string'
      ? (meta.kitstak_org_id as string)
      : null;
  const role =
    typeof meta.kitstak_org_role === 'string'
      ? (meta.kitstak_org_role as RoleCode)
      : null;
  const sessionId =
    typeof payload.session_id === 'string'
      ? (payload.session_id as string)
      : undefined;

  return sessionId !== undefined
    ? { userId, orgId, role, sessionId }
    : { userId, orgId, role };
}

/**
 * Strict caller resolver. Every state-changing handler calls this at the top.
 *
 * Throws:
 *   UNAUTHORIZED (401) when the Authorization header is missing or the JWT
 *     payload is unreadable.
 *   NO_ACTIVE_ORG (401) when the JWT decodes but carries no
 *     app_metadata.kitstak_org_id.
 *   FORBIDDEN (403) when the JWT carries no app_metadata.kitstak_org_role.
 *     This indicates a malformed identity record; the SPA should not allow
 *     login without a role to land on a protected route.
 */
export function requireCaller(req: Request): Caller {
  const ctx = readCallerContext(req);
  if (!ctx.userId) {
    throw new ApiError(ERROR_CODES.UNAUTHORIZED, 401, 'Authentication required.');
  }
  if (!ctx.orgId) {
    throw new ApiError(ERROR_CODES.NO_ACTIVE_ORG, 401, 'No active organization claim.');
  }
  if (!ctx.role) {
    throw new ApiError(ERROR_CODES.FORBIDDEN, 403, 'Role missing from caller claims.');
  }
  const out: Caller = {
    userId: ctx.userId,
    orgId: ctx.orgId,
    role: ctx.role,
  };
  if (ctx.sessionId !== undefined) out.sessionId = ctx.sessionId;
  return out;
}
