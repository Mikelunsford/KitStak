// auth-api: session-shape and workspace-switch surface.
//
// Routes:
//   GET  /me                       Resolve caller identity + memberships.
//   GET  /me/capabilities          Effective identity-capability set.
//   POST /sessions/switch-org      Stamp the active org claim onto the user's
//                                  app_metadata (Supabase admin updateUserById).
//
// All routes require an authenticated caller. The /me family returns 200 with
// `active_org_id: null, active_role: null` if the JWT lacks an org claim, so
// the SPA can route to the org-picker without surfacing a 401 to the user.
// Switch-org requires Idempotency-Key (UUID v4) per the constitution.

import { route, type RouteCtx } from '../_shared/route.ts';
import {
  admin,
  respondWithIdempotency,
  parseBody,
} from '../_shared/handler-helpers.ts';
import {
  readCallerContext,
  requireCaller,
} from '../_shared/tenant.ts';
import { ok, created, ApiError } from '../_shared/responses.ts';
import {
  MeResponseSchema,
  SwitchOrgRequestSchema,
  type MembershipSummary,
} from '../_shared/types/identity.ts';
import {
  IDENTITY_CAPABILITY_POLICY,
  hasIdentityCap,
  type IdentityCapability,
} from '../_shared/capabilities/identity.ts';
import type { Caller } from '../_shared/tenant.ts';

/**
 * Local capability gate for identity-side-car capabilities. The master
 * `_shared/capabilities.ts` canon does not yet carry the identity tuples
 * (the Canon Steward composes them at wave close). Until then handlers in
 * this bundle gate via the side-car directly.
 */
function requireIdentityCap(caller: Caller, cap: IdentityCapability): void {
  if (hasIdentityCap(caller.role, cap)) return;
  throw new ApiError('FORBIDDEN', 403, `caller lacks capability: ${cap}`);
}

const BUNDLE = 'auth-api';

async function getMe(ctx: RouteCtx): Promise<Response> {
  const caller = readCallerContext(ctx.req);
  if (!caller.userId) {
    throw new ApiError('UNAUTHORIZED', 401, 'Authentication required.');
  }

  const sb = admin();

  // Pull profile. Missing profile is recoverable; we surface user_id + email
  // from the JWT-decoded auth.users record so the SPA always has a name.
  const { data: authUser, error: authError } =
    await sb.auth.admin.getUserById(caller.userId);
  if (authError || !authUser?.user) {
    throw new ApiError(
      'INTERNAL_ERROR',
      500,
      `failed to read auth user: ${authError?.message ?? 'unknown'}`,
    );
  }

  const profileQ = await sb
    .from('profiles')
    .select('display_name, email')
    .eq('user_id', caller.userId)
    .maybeSingle();

  if (profileQ.error) {
    throw new ApiError(
      'INTERNAL_ERROR',
      500,
      `profile lookup failed: ${profileQ.error.message}`,
    );
  }

  const email =
    profileQ.data?.email ?? authUser.user.email ?? 'unknown@kitstak.local';
  const displayName =
    profileQ.data?.display_name ?? authUser.user.user_metadata?.full_name ?? null;

  // Memberships join through to organizations and roles. We filter active
  // rows only; suspended-org rows still appear so the SPA can show them
  // disabled, but the cleanest baseline is is_active and the org not archived.
  const membershipQ = await sb
    .from('org_memberships')
    .select(
      `
      org_id,
      role:roles!inner(code),
      is_active,
      organizations!inner(id, slug, display_name, status, deleted_at)
    `,
    )
    .eq('user_id', caller.userId)
    .eq('is_active', true);

  if (membershipQ.error) {
    throw new ApiError(
      'INTERNAL_ERROR',
      500,
      `membership lookup failed: ${membershipQ.error.message}`,
    );
  }

  type MembershipJoinRow = {
    org_id: string;
    role: { code: string } | { code: string }[] | null;
    is_active: boolean;
    organizations:
      | {
          id: string;
          slug: string;
          display_name: string;
          status: string;
          deleted_at: string | null;
        }
      | {
          id: string;
          slug: string;
          display_name: string;
          status: string;
          deleted_at: string | null;
        }[]
      | null;
  };

  const memberships: MembershipSummary[] = [];
  for (const raw of (membershipQ.data ?? []) as MembershipJoinRow[]) {
    const org = Array.isArray(raw.organizations)
      ? raw.organizations[0]
      : raw.organizations;
    if (!org || org.deleted_at !== null || org.status === 'archived') continue;
    const roleObj = Array.isArray(raw.role) ? raw.role[0] : raw.role;
    if (!roleObj) continue;
    memberships.push({
      org_id: raw.org_id,
      org_slug: org.slug,
      display_name: org.display_name,
      role: roleObj.code as MembershipSummary['role'],
      is_default: org.id === caller.orgId,
    });
  }

  // Sole-membership fallback. If the JWT carries no org claim but the user
  // has exactly one membership, project that as the active context so the
  // SPA can land directly on the dashboard.
  let activeOrgId: string | null = caller.orgId;
  let activeRole: MembershipSummary['role'] | null =
    (caller.role as MembershipSummary['role'] | null) ?? null;
  if (!activeOrgId && memberships.length === 1) {
    activeOrgId = memberships[0]!.org_id;
    activeRole = memberships[0]!.role;
  }

  const body = MeResponseSchema.parse({
    user_id: caller.userId,
    email,
    display_name: displayName,
    active_org_id: activeOrgId,
    active_role: activeRole,
    memberships,
  });

  return ok(body);
}

function getMyCapabilities(ctx: RouteCtx): Response {
  const caller = readCallerContext(ctx.req);
  if (!caller.userId || !caller.role) {
    throw new ApiError(
      'UNAUTHORIZED',
      401,
      'Authentication and active role required.',
    );
  }
  const role = caller.role as keyof typeof IDENTITY_CAPABILITY_POLICY;
  return ok({
    role,
    capabilities: [...IDENTITY_CAPABILITY_POLICY[role]],
  });
}

async function postSwitchOrg(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireIdentityCap(caller, 'identity.session.switch');
  const body = await parseBody(ctx.req, SwitchOrgRequestSchema);

  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    '/sessions/switch-org',
    body,
    async () => {
      const sb = admin();

      // Confirm membership in the requested org. Defence in depth: the
      // capability is granted to all roles, but the user must actually
      // belong to the org they are switching into.
      const { data: membership, error: membershipErr } = await sb
        .from('org_memberships')
        .select('role:roles!inner(code), is_active')
        .eq('user_id', caller.userId)
        .eq('org_id', body.org_id)
        .eq('is_active', true)
        .maybeSingle();

      if (membershipErr) {
        throw new ApiError(
          'INTERNAL_ERROR',
          500,
          `membership lookup failed: ${membershipErr.message}`,
        );
      }
      if (!membership) {
        // Surfaced as 404 per the constitution: cross-tenant reads return
        // 200 + []; a workflow POST against a tenant the caller does not
        // belong to returns 404 to avoid existence leak.
        throw new ApiError('NOT_FOUND', 404, 'Organization not found.');
      }

      const roleObj = Array.isArray(membership.role)
        ? membership.role[0]
        : membership.role;
      if (!roleObj) {
        throw new ApiError(
          'INTERNAL_ERROR',
          500,
          'membership role missing',
        );
      }

      // Stamp the claim onto app_metadata. The SPA refreshSession picks up
      // the new JWT on the next round-trip; current_org_id() reads from
      // there in the Postgres helpers.
      const { error: updateErr } = await sb.auth.admin.updateUserById(
        caller.userId,
        {
          app_metadata: {
            kitstak_org_id: body.org_id,
            kitstak_org_role: roleObj.code,
          },
        },
      );
      if (updateErr) {
        throw new ApiError(
          'INTERNAL_ERROR',
          500,
          `claim update failed: ${updateErr.message}`,
        );
      }

      // Also record the last_org_id on the profile so the next sign-in
      // restores the same workspace by default.
      await sb
        .from('profiles')
        .update({ last_org_id: body.org_id, updated_at: new Date().toISOString() })
        .eq('user_id', caller.userId);

      return created({ org_id: body.org_id, role: roleObj.code });
    },
  );
}

Deno.serve((req: Request) =>
  route(
    req,
    [
      { method: 'GET',  path: '/me',                  handler: getMe },
      { method: 'GET',  path: '/me/capabilities',     handler: (ctx) => Promise.resolve(getMyCapabilities(ctx)) },
      { method: 'POST', path: '/sessions/switch-org', handler: postSwitchOrg },
    ],
    { bundle: BUNDLE },
  ),
);
