// auth-api: session-shape, workspace-switch, and customer-portal re-entry.
//
// Routes:
//   GET  /me                       Resolve caller identity + memberships.
//   GET  /me/capabilities          Effective identity-capability set.
//   POST /sessions/switch-org      Stamp the active org claim onto the user's
//                                  app_metadata (Supabase admin updateUserById).
//   POST /portal/request-signin-link
//                                  Public (no JWT). Anonymous callers POST an
//                                  email; if it is bound to a customer_user
//                                  org_membership, we generate a fresh Supabase
//                                  magic link and ship it through the Resend
//                                  notifications chassis. Always returns 200
//                                  with the same envelope to prevent email-
//                                  enumeration attacks.
//
// The /me family returns 200 with `active_org_id: null, active_role: null` if
// the JWT lacks an org claim, so the SPA can route to the org-picker without
// surfacing a 401 to the user. Switch-org requires Idempotency-Key (UUID v4)
// per the constitution.

import { z } from 'zod';

import { route, type RouteCtx } from '../_shared/route.ts';
import {
  admin,
  respondWithIdempotency,
  parseBody,
  requireCap,
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
import { CAPABILITIES_BY_ROLE } from '../_shared/capabilities.ts';

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
  const role = caller.role as keyof typeof CAPABILITIES_BY_ROLE;
  return ok({
    role,
    capabilities: [...CAPABILITIES_BY_ROLE[role]],
  });
}

async function postSwitchOrg(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'identity.session.switch');
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

// ---------------------------------------------------------------------------
// POST /portal/request-signin-link
//
// Public route. Anonymous callers POST { email } and we respond 200 with a
// generic "If that email is registered, a sign-in link is on its way." body
// regardless of whether the email is bound to a customer_user membership.
// The actual link generation happens server-side only when (a) the email
// resolves to an auth.users row AND (b) that user holds a customer_user
// org_membership. In every other case we return the same envelope so the
// endpoint never reveals which emails are registered (constitutional anti-
// leak rule, same shape as the customer-portal-api 404 contract).
//
// Constitutional deviation, documented:
//   The constitution requires Idempotency-Key on every non-GET handler with
//   storage scoped to `(key, user_id, org_id, route_hash)`. This endpoint is
//   pre-authentication: there is no caller user_id. Forcing a synthetic anon
//   user_id into the idempotency table pollutes it without gaining the
//   intended "same key returns the same body" property, because each call
//   intrinsically MUST generate a fresh single-use link (the prior call's
//   token gets invalidated by the new one anyway). We therefore skip the
//   wrapper for this single route and document the divergence here. Rate
//   limiting is deferred to F-Wave9-PORTAL-SIGNIN-RATE-LIMIT-01; in v1 the
//   notifications 5-minute drain cron + Resend's account-level rate limits
//   bound abuse.
// ---------------------------------------------------------------------------
// Normalise (trim + lowercase) BEFORE email validation so users who type
// leading/trailing whitespace or mixed case still resolve to the canonical
// row in auth.users.
const RequestSignInLinkSchema = z.object({
  email: z
    .string()
    .transform((s) => s.trim().toLowerCase())
    .pipe(z.string().email()),
});

// Stable success envelope. Identical for "email is a customer_user", "email
// exists but is not a customer_user", "email does not exist at all", and
// "Supabase generateLink failed". Any divergence would leak existence.
const SIGNIN_LINK_RESPONSE = {
  ok: true,
  message:
    'If that email is registered for a Kitstak customer portal, a sign-in link is on its way.',
};

const PORTAL_REDIRECT_URL = 'https://www.kitstak.com/portal';

async function postRequestSignInLink(ctx: RouteCtx): Promise<Response> {
  let body: { email: string };
  try {
    body = await parseBody(ctx.req, RequestSignInLinkSchema);
  } catch {
    // Constitutional anti-leak: a malformed body must NOT distinguish itself
    // from a valid one whose email is not registered. Return the same
    // success envelope. Real input-shape problems (developer error in the
    // SPA wiring) will surface in browser devtools via the Supabase
    // generateLink call never firing, not via an error response.
    return ok(SIGNIN_LINK_RESPONSE);
  }

  // The Zod schema already normalised (trim + lowercase). Use as-is.
  const email = body.email;
  const sb = admin();

  // Look up the auth.users row for this email. The service-role client
  // can read auth.users directly via the admin helpers; listUsers with a
  // filter is the documented path.
  // listUsers returns paginated results; the filter narrows server-side.
  const { data: usersPage, error: usersErr } = await sb.auth.admin.listUsers({
    page: 1,
    perPage: 1,
    filter: `email eq "${email.replace(/"/g, '')}"`,
  } as unknown as { page: number; perPage: number });
  if (usersErr) {
    // Internal-side failure: log but return success envelope so the
    // attacker cannot infer existence from response shape.
    console.error('auth-api: listUsers failed during portal signin', {
      message: usersErr.message,
    });
    return ok(SIGNIN_LINK_RESPONSE);
  }
  const user = usersPage?.users?.find((u) => u.email?.toLowerCase() === email);
  if (!user) return ok(SIGNIN_LINK_RESPONSE);

  // The user exists. Confirm they hold a customer_user org_membership before
  // generating any link. We join through roles to keep the role-code coupling
  // explicit; this also defends against a stale auth.users row whose
  // membership was deactivated.
  const { data: memberships, error: memErr } = await sb
    .from('org_memberships')
    .select('org_id, is_active, role:roles!inner(code)')
    .eq('user_id', user.id)
    .eq('is_active', true);
  if (memErr) {
    console.error('auth-api: membership lookup failed during portal signin', {
      message: memErr.message,
    });
    return ok(SIGNIN_LINK_RESPONSE);
  }
  type MembershipRow = {
    org_id: string;
    is_active: boolean;
    role: { code: string } | { code: string }[] | null;
  };
  const portalMembership = (memberships ?? ([] as MembershipRow[])).find(
    (m: MembershipRow) => {
      const role = Array.isArray(m.role) ? m.role[0] : m.role;
      return role?.code === 'customer_user';
    },
  );
  if (!portalMembership) return ok(SIGNIN_LINK_RESPONSE);

  // Eligible. Generate a fresh single-use magic link.
  const { data: linkData, error: linkErr } = await sb.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo: PORTAL_REDIRECT_URL },
  });
  if (linkErr || !linkData?.properties?.action_link) {
    console.error('auth-api: generateLink failed during portal signin', {
      message: linkErr?.message,
    });
    return ok(SIGNIN_LINK_RESPONSE);
  }
  const actionLink = linkData.properties.action_link;

  // Queue the branded email through the same notifications + Resend chassis
  // proven in Path B1. The 5-minute drain cron ships it.
  const subject = 'Sign in to your Kitstak portal';
  const emailBody =
    `Hello,\n\n` +
    `Click the link below to sign in to your Kitstak customer portal. ` +
    `No password required.\n\n` +
    `${actionLink}\n\n` +
    `This link signs you in directly and expires after one hour. ` +
    `If you did not request this, you can ignore this email.\n\n` +
    `Thanks.`;
  const { error: notifErr } = await sb.from('notifications').insert({
    org_id: portalMembership.org_id,
    recipient_user_id: user.id,
    entity_type: 'auth',
    entity_id: null,
    channel: 'email',
    subject,
    body: emailBody,
    payload: { to: email, kind: 'portal_signin' },
    created_by: user.id,
    updated_by: user.id,
  });
  if (notifErr) {
    console.error('auth-api: failed to queue portal-signin email', {
      org_id: portalMembership.org_id,
      message: notifErr.message,
    });
  }

  return ok(SIGNIN_LINK_RESPONSE);
}

Deno.serve((req: Request) =>
  route(
    req,
    [
      { method: 'GET',  path: '/me',                          handler: getMe },
      { method: 'GET',  path: '/me/capabilities',             handler: (ctx) => Promise.resolve(getMyCapabilities(ctx)) },
      { method: 'POST', path: '/sessions/switch-org',         handler: postSwitchOrg },
      { method: 'POST', path: '/portal/request-signin-link',  handler: postRequestSignInLink },
    ],
    { bundle: BUNDLE },
  ),
);
