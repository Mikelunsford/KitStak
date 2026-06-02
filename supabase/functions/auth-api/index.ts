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
//   POST /auth/request-password-reset
//                                  Public (no JWT). Anonymous callers POST an
//                                  email; if it resolves to an auth.users row
//                                  we generate a Supabase recovery link and
//                                  ship it via the same Resend chassis. Always
//                                  returns 200 with the same envelope for
//                                  anti-enumeration. Closes
//                                  F-Wave9-INVITE-PASSWORD-SETUP-01 backend.
//
// The /me family returns 200 with `active_org_id: null, active_role: null` if
// the JWT lacks an org claim, so the SPA can route to the org-picker without
// surfacing a 401 to the user. Switch-org requires Idempotency-Key (UUID v4)
// per the constitution.

import { z } from 'zod';

import { route, type RouteCtx } from '../_shared/route.ts';
import {
  admin,
  created,
  respondWithIdempotency,
  parseBody,
  parseUuidParam,
  requireCap,
} from '../_shared/handler-helpers.ts';
import {
  readCallerContext,
  requireCaller,
} from '../_shared/tenant.ts';
import { ok, ApiError, internalError } from '../_shared/responses.ts';
import {
  InviteStaffRequestSchema,
  MeResponseSchema,
  OrgMemberRowSchema,
  OrgMembersListResponseSchema,
  PatchOrgMemberRequestSchema,
  ResendOrgMemberInviteResponseSchema,
  SwitchOrgRequestSchema,
  type MembershipSummary,
  type OrgMemberRow,
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
    throw internalError(
      'auth-api/getMe:auth_user_lookup',
      authError ?? 'auth user not found',
    );
  }

  const profileQ = await sb
    .from('profiles')
    .select('display_name, email')
    .eq('user_id', caller.userId)
    .maybeSingle();

  if (profileQ.error) {
    throw internalError('auth-api/getMe:profile_lookup', profileQ.error);
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
    throw internalError('auth-api:membership_lookup_failed', membershipQ.error);
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
        throw internalError('auth-api:membership_lookup_failed', membershipErr);
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
        throw internalError('auth-api:claim_update_failed', updateErr);
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
  // D3: per-email / per-IP rate limiting on this endpoint is deferred to
  // F-Wave9-PORTAL-SIGNIN-RATE-LIMIT-01. Not implemented here.
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

  // Resolve the email to a user via the profiles table, then load the auth
  // user by id (D7, F-Wave10-REVIEW-REMEDIATION). This removes the prior
  // listUsers filter-string interpolation surface entirely: the email is now
  // a parameterised `.eq('email', email)` predicate, never woven into a
  // PostgREST/GoTrue filter string. Anti-enumeration is preserved: every
  // miss / internal failure returns the same constant SIGNIN_LINK_RESPONSE.
  const profileLookup = await sb
    .from('profiles')
    .select('user_id')
    .eq('email', email)
    .maybeSingle();
  if (profileLookup.error) {
    // Internal-side failure: log but return success envelope so the
    // attacker cannot infer existence from response shape.
    console.error('auth-api: profile lookup failed during portal signin', {
      message: profileLookup.error.message,
    });
    return ok(SIGNIN_LINK_RESPONSE);
  }
  if (!profileLookup.data) return ok(SIGNIN_LINK_RESPONSE);
  const { data: authUser, error: authErr } = await sb.auth.admin.getUserById(
    profileLookup.data.user_id,
  );
  if (authErr) {
    console.error('auth-api: getUserById failed during portal signin', {
      message: authErr.message,
    });
    return ok(SIGNIN_LINK_RESPONSE);
  }
  const user = authUser?.user ?? null;
  if (!user || user.email?.toLowerCase() !== email) {
    return ok(SIGNIN_LINK_RESPONSE);
  }

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

// ---------------------------------------------------------------------------
// GET /members
//
// List the staff memberships for the caller's active org. Closes
// F-Wave9-STAFF-INVITE-MEMBERS-LIST-01 backend half. Replaces the v1 stub
// on /admin/members that only showed the caller themselves.
//
// Flow:
//   1. requireCap('org.member.list') gates the route. Granted to org_owner,
//      org_admin, ops, accounting, viewer. Denied to sales, customer_user,
//      vendor_user. Anyone who can see the dashboard should be able to see
//      who else is on the team.
//   2. Query org_memberships filtered by caller.orgId (RLS Pattern A
//      inherits the constraint, but we filter defensively in case a future
//      change relaxes the policy). Joins roles to project the role code +
//      human label inline.
//   3. Resolve email + display_name per user_id via a single profiles
//      lookup; profiles is the public-schema mirror of auth.users that
//      getMe already trusts. Members without a profile row fall back to
//      a placeholder email derived from auth.users via admin.getUserById.
//      In practice every staff user has a profile row because the
//      first-signin trigger backfills it, so the fallback is defence in
//      depth.
//   4. Returns a flat array (NOT { items: ... }) per the F-Wave7-
//      LISTENVELOPE-01 canon. No pagination for v1; orgs are expected to
//      have well under 50 staff for the first year. Adding a cursor later
//      is a non-breaking shape change (envelope stays a flat array, meta
//      adds next_cursor).
//
// Capability: org.member.list. No idempotency wrapper required (GET).
// Cross-tenant: RLS filters to caller.orgId; the explicit .eq is belt-and-
// braces. A cross-tenant caller therefore receives 200 + the rows of their
// own org, never 404, per the constitutional "RLS filters, never throws"
// rule for read endpoints.
// ---------------------------------------------------------------------------

async function listOrgMembers(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'org.member.list');

  const sb = admin();

  // Step 1: pull the active memberships in the caller's org, joining the
  // role table so we can project both code and label without a second
  // round-trip.
  const membershipQ = await sb
    .from('org_memberships')
    .select(
      `
      user_id,
      org_id,
      is_active,
      created_at,
      role:roles!inner(code, label)
    `,
    )
    .eq('org_id', caller.orgId)
    .eq('is_active', true);

  if (membershipQ.error) {
    throw internalError('auth-api:membership_lookup_failed', membershipQ.error);
  }

  type MembershipJoinRow = {
    user_id: string;
    org_id: string;
    is_active: boolean;
    created_at: string;
    role: { code: string; label: string } | { code: string; label: string }[] | null;
  };

  const rawRows = (membershipQ.data ?? []) as MembershipJoinRow[];
  if (rawRows.length === 0) {
    // Defensive: should never happen because the caller is themselves a
    // member of the org and we filter on is_active. Returning early avoids
    // a no-op profiles query.
    return ok(OrgMembersListResponseSchema.parse([] as OrgMemberRow[]));
  }

  const userIds = rawRows.map((r) => r.user_id);

  // Step 2: resolve email + display_name from public.profiles for every
  // member in one batched query. profiles is keyed by user_id and is the
  // canonical public-schema mirror of auth.users; getMe trusts the same
  // source.
  const profilesQ = await sb
    .from('profiles')
    .select('user_id, email, display_name')
    .in('user_id', userIds);

  if (profilesQ.error) {
    throw internalError('auth-api:profiles_lookup_failed', profilesQ.error);
  }

  type ProfileRow = {
    user_id: string;
    email: string | null;
    display_name: string | null;
  };

  const profilesById = new Map<string, ProfileRow>();
  for (const p of (profilesQ.data ?? []) as ProfileRow[]) {
    profilesById.set(p.user_id, p);
  }

  // Step 3: resolve auth.users.email_confirmed_at per member so the SPA can
  // gate the per-row Resend button. The Resend button only fires for rows
  // that have not yet claimed (no completed sign-in). admin.getUserById is
  // the documented per-user accessor; supabase-js does not expose a batched
  // get-many-by-ids surface, so we issue one call per member. Org member
  // counts are bounded (<50 for the first operator year) so the round-trip
  // cost is acceptable. A getUserById failure is treated as "claimed"
  // (defaults to hiding the Resend button) so a transient auth error never
  // produces a stuck "send the invite again" affordance.
  // F-Wave9-STAFF-INVITE-RESEND-01.
  const claimedById = new Map<string, boolean>();
  for (const userId of userIds) {
    const { data: authData, error: authErr } =
      await sb.auth.admin.getUserById(userId);
    if (authErr) {
      console.warn('auth-api: getUserById failed during members list', {
        org_id: caller.orgId,
        user_id: userId,
        message: authErr.message,
      });
      claimedById.set(userId, true);
      continue;
    }
    const confirmed =
      (authData?.user as { email_confirmed_at?: string | null } | undefined)
        ?.email_confirmed_at ?? null;
    claimedById.set(userId, confirmed !== null);
  }

  // Step 4: project the wire shape. Skip rows missing a role or a profile-
  // resolvable email so the response always parses cleanly through the
  // OrgMemberRowSchema (email is z.string().email()). A missing profile is
  // logged because it indicates a backfill gap rather than expected state.
  const out: OrgMemberRow[] = [];
  for (const raw of rawRows) {
    const role = Array.isArray(raw.role) ? raw.role[0] : raw.role;
    if (!role) continue;
    const profile = profilesById.get(raw.user_id);
    if (!profile || !profile.email) {
      console.warn('auth-api: org member missing profile row', {
        org_id: caller.orgId,
        user_id: raw.user_id,
      });
      continue;
    }
    out.push({
      user_id: raw.user_id,
      org_id: raw.org_id,
      email: profile.email,
      display_name: profile.display_name,
      role_code: role.code as OrgMemberRow['role_code'],
      role_display_name: role.label,
      created_at: raw.created_at,
      is_active: raw.is_active,
      claimed: claimedById.get(raw.user_id) ?? true,
    });
  }

  return ok(OrgMembersListResponseSchema.parse(out));
}

// ---------------------------------------------------------------------------
// POST /members/invite
//
// Staff invite chassis. An org_owner or org_admin invites a teammate via
// email. Closes F-Wave9-STAFF-INVITE-CHASSIS-01 backend half.
//
// Flow mirrors the customer portal invite (crm-api inviteCustomerToPortal):
//   1. requireCap('org.member.invite') gates the route.
//   2. Privilege-escalation guard: org_admin cannot grant org_owner.
//   3. supabase.auth.admin.generateLink({ type: 'magiclink' }) produces a
//      single-use sign-in URL. The link creates auth.users on demand for
//      first-time recipients and reuses the existing row otherwise.
//   4. create_staff_membership RPC (migration 0065) atomically links the
//      auth user to the org with the requested role. Idempotent.
//   5. Stamp the org claim onto the invitee's app_metadata so the first JWT
//      Supabase mints when they click the magic link already carries
//      kitstak_org_id and kitstak_org_role. Without this every org-scoped
//      Edge API 401s on the first sign-in. Closes
//      F-Wave9-STAFF-INVITE-CLAIM-STAMP-01.
//   6. A branded invite email is queued through the notifications chassis;
//      the 5-minute drain cron ships it via Resend.
//
// Capability: org.member.invite (granted to org_owner and org_admin only).
// Idempotency: respondWithIdempotency wraps the side-effecting block so a
// re-click of the same Invite button (same key + same body) replays the
// stored response without firing a second generateLink, RPC call, claim
// stamp, or notifications insert.
// ---------------------------------------------------------------------------
const STAFF_INVITE_REDIRECT_URL = 'https://www.kitstak.com/dashboard';

async function postInviteStaffMember(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'org.member.invite');
  const body = await parseBody(ctx.req, InviteStaffRequestSchema);

  // Privilege-escalation guard. An org_admin can invite peers up to org_admin
  // but cannot mint another org_owner; only an existing org_owner can do
  // that. The capability matrix grants org.member.invite to both roles, so
  // this is the second gate the role-specific power check rides on.
  if (body.role === 'org_owner' && caller.role !== 'org_owner') {
    throw new ApiError(
      'FORBIDDEN',
      403,
      'Only an org owner can invite another org owner.',
    );
  }

  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    '/members/invite',
    body,
    async () => {
      const sb = admin();

      // Generate the sign-in link. Creates an auth.users row on first invite
      // for a new email, returns the existing row for a re-invite. The
      // returned action_link is the user-facing magic link embedded in the
      // notifications email body.
      const linkResult = await sb.auth.admin.generateLink({
        type: 'magiclink',
        email: body.email,
        options: { redirectTo: STAFF_INVITE_REDIRECT_URL },
      });
      if (linkResult.error) {
        throw new ApiError(
          'AUTH_ERROR',
          422,
          'Could not generate invite link.',
          { detail: linkResult.error.message },
        );
      }
      const inviteeUserId = linkResult.data.user?.id;
      const actionLink = linkResult.data.properties?.action_link;
      if (!inviteeUserId || !actionLink) {
        throw new ApiError(
          'INTERNAL_ERROR',
          500,
          'Auth magic-link generation returned no user id or action_link',
        );
      }

      // Atomically bind the invitee to the caller's org with the requested
      // role via the SECURITY DEFINER RPC. The RPC is idempotent on
      // (org_id, user_id) so a re-invite returns the existing membership id
      // without changing role or activation state.
      const { data: membershipId, error: rpcError } = await sb.rpc(
        'create_staff_membership',
        {
          p_org_id: caller.orgId,
          p_user_id: inviteeUserId,
          p_role_code: body.role,
          p_invited_by: caller.userId,
        },
      );
      if (rpcError) {
        throw internalError('auth-api:staff_membership_creation', rpcError);
      }

      // Stamp the org claim onto the invitee's app_metadata so the very
      // first JWT Supabase mints when they click the magic link already
      // carries kitstak_org_id + kitstak_org_role. Without this every
      // org-scoped Edge API 401s on first sign-in and the invitee is stuck
      // until /sessions/switch-org fires the SPA fallback. Closes
      // F-Wave9-STAFF-INVITE-CLAIM-STAMP-01.
      //
      // Failure is logged but does not unwind: the membership row already
      // exists, the invitee can still self-heal via the SPA switch-org
      // fallback, and the next invite click will retry the stamp (idempotent
      // at the auth.admin layer).
      const { error: stampErr } = await sb.auth.admin.updateUserById(
        inviteeUserId,
        {
          app_metadata: {
            kitstak_org_id: caller.orgId,
            kitstak_org_role: body.role,
          },
        },
      );
      if (stampErr) {
        console.error('auth-api: failed to stamp invitee app_metadata', {
          org_id: caller.orgId,
          user_id: inviteeUserId,
          message: stampErr.message,
        });
      }

      // Resolve the org display_name for the invite email subject + body.
      // Fall back to 'Kitstak' when the org row lookup fails or is unexpectedly
      // missing; the membership already exists so the invitee can still sign
      // in. Closes F-Wave9-INVITE-EMAIL-SUBJECT-COPY-01: prior copy read
      // "You have been invited to Kitstak on Kitstak" when the inviting org's
      // display_name IS Kitstak. Rephrased to drop the "on Kitstak" suffix
      // from the subject so the org name carries the message cleanly.
      let orgDisplayName = 'Kitstak';
      const { data: orgRow, error: orgLookupErr } = await sb
        .from('organizations')
        .select('display_name')
        .eq('id', caller.orgId)
        .maybeSingle();
      if (orgLookupErr) {
        console.error('auth-api: failed to resolve org display_name for invite', {
          org_id: caller.orgId,
          message: orgLookupErr.message,
        });
      } else if (orgRow && typeof orgRow.display_name === 'string') {
        orgDisplayName = orgRow.display_name;
      }

      // Queue the branded invite email through the notifications chassis.
      // The 5-minute drain cron picks this up and ships via Resend. Failure
      // to queue is logged but does not unwind the membership; the caller
      // can re-click Invite to retry queuing.
      const subject = `You have been invited to join ${orgDisplayName}`;
      const emailBody =
        `You have been invited to join ${orgDisplayName} on Kitstak.\n\n` +
        'Click the link below to sign in.\n\n' +
        `${actionLink}\n\n` +
        'This link expires in 24 hours.';
      const { error: notifErr } = await sb.from('notifications').insert({
        org_id: caller.orgId,
        recipient_user_id: inviteeUserId,
        channel: 'email',
        subject,
        body: emailBody,
        payload: { to: body.email, type: 'staff_invite' },
        created_by: caller.userId,
        updated_by: caller.userId,
      });
      if (notifErr) {
        console.error('auth-api: failed to queue staff-invite email', {
          org_id: caller.orgId,
          message: notifErr.message,
        });
      }

      return created({
        user_id: inviteeUserId,
        membership_id: membershipId,
        role: body.role,
        email: body.email,
      });
    },
  );
}

// ---------------------------------------------------------------------------
// POST /auth/request-password-reset
//
// Public route. An anonymous caller posts { email } and we ship a Supabase
// recovery link via the same Resend chassis used by the staff invite and
// portal sign-in emails. Closes F-Wave9-INVITE-PASSWORD-SETUP-01 backend.
//
// Anti-enumeration posture (constitutional, mirrors postRequestSignInLink):
//   - Every code path returns the same envelope `{ accepted: true }` with
//     status 200, regardless of whether the email resolves to an auth.users
//     row, whether generateLink succeeds, or whether the notifications insert
//     errors out. The only differentiator a probe could see is timing, which
//     is bounded by the worker drain cadence on the email side.
//   - Body validation failures also return 200 with the same envelope so a
//     400/422 cannot be used to distinguish "no such email" from "bad shape".
//
// Idempotency:
//   This is a pre-authentication endpoint. There is no caller user_id to
//   scope the idempotency row to and each invocation MUST generate a fresh
//   single-use recovery token (the prior token is invalidated server-side
//   when a new one is minted), so respondWithIdempotency would not provide
//   the intended "same key returns the same body" guarantee. We therefore
//   skip the wrapper. Same divergence is documented on postRequestSignInLink.
// ---------------------------------------------------------------------------
const PASSWORD_RECOVERY_REDIRECT_URL = 'https://www.kitstak.com/auth/recovery';

const PASSWORD_RESET_RESPONSE = { accepted: true as const };

// Local normalising schema. The byte-mirrored RequestPasswordResetSchema
// in _shared/types/identity.ts is the wire contract used by the SPA; the
// handler decorates with a trim + lowercase transform before email
// validation so callers that send leading/trailing whitespace or mixed
// case still resolve to the canonical auth.users row. Mirrors the same
// pattern as RequestSignInLinkSchema above.
const RequestPasswordResetNormalisedSchema = z.object({
  email: z
    .string()
    .transform((s) => s.trim().toLowerCase())
    .pipe(z.string().email()),
});

async function postRequestPasswordReset(ctx: RouteCtx): Promise<Response> {
  let body: { email: string };
  try {
    body = await parseBody(ctx.req, RequestPasswordResetNormalisedSchema);
  } catch {
    // Anti-enumeration: malformed body must not differentiate from a valid
    // body whose email is not registered. Same posture as the portal
    // signin endpoint.
    return ok(PASSWORD_RESET_RESPONSE);
  }

  // The schema already normalised; use as-is.
  const email = body.email;
  const sb = admin();

  // Resolve the email to a user via the profiles table, then load the auth
  // user by id (D7, F-Wave10-REVIEW-REMEDIATION). Same pattern as
  // postRequestSignInLink: the email is a parameterised predicate, not a
  // filter string, and every miss / failure returns the constant
  // PASSWORD_RESET_RESPONSE so existence can never be inferred.
  const profileLookup = await sb
    .from('profiles')
    .select('user_id')
    .eq('email', email)
    .maybeSingle();
  if (profileLookup.error) {
    console.error('auth-api: profile lookup failed during password-reset', {
      message: profileLookup.error.message,
    });
    return ok(PASSWORD_RESET_RESPONSE);
  }
  if (!profileLookup.data) {
    return ok(PASSWORD_RESET_RESPONSE);
  }
  const { data: authUser, error: authErr } = await sb.auth.admin.getUserById(
    profileLookup.data.user_id,
  );
  if (authErr) {
    console.error('auth-api: getUserById failed during password-reset', {
      message: authErr.message,
    });
    return ok(PASSWORD_RESET_RESPONSE);
  }
  const user = authUser?.user ?? null;
  if (!user || user.email?.toLowerCase() !== email) {
    return ok(PASSWORD_RESET_RESPONSE);
  }

  const linkResult = await sb.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: PASSWORD_RECOVERY_REDIRECT_URL },
  });

  if (linkResult.error || !linkResult.data?.properties?.action_link) {
    console.error('auth-api: generateLink failed during password-reset', {
      message: linkResult.error?.message,
    });
    return ok(PASSWORD_RESET_RESPONSE);
  }

  const actionLink = linkResult.data.properties.action_link;

  // Queue the branded recovery email. org_id is NULL because recovery is a
  // user-scoped concern (a user belongs to many orgs but has one password).
  // Migration 0066 drops the NOT NULL on notifications.org_id to support
  // this. The drain cron picks it up and ships via Resend.
  const subject = 'Reset your Kitstak password';
  const emailBody =
    'A password reset was requested for this email. ' +
    'Click the link below to set a new password.\n\n' +
    `${actionLink}\n\n` +
    'This link expires in one hour. If you did not request a reset, ' +
    'ignore this email and your password will stay the same.';

  const { error: notifErr } = await sb.from('notifications').insert({
    org_id: null,
    recipient_user_id: user.id,
    entity_type: 'auth',
    entity_id: null,
    channel: 'email',
    subject,
    body: emailBody,
    payload: { to: email, kind: 'password_reset' },
    created_by: user.id,
    updated_by: user.id,
  });
  if (notifErr) {
    console.error('auth-api: failed to queue password-reset email', {
      user_id: user.id,
      message: notifErr.message,
    });
  }

  return ok(PASSWORD_RESET_RESPONSE);
}

// ---------------------------------------------------------------------------
// PATCH /members/:user_id
//
// Per-row role change + deactivate / reactivate on the team-members list.
// Closes F-Wave9-STAFF-INVITE-PATCH-01 backend.
//
// Flow:
//   1. requireCap('org.member.update') gates the route. Granted to org_owner
//      and org_admin only.
//   2. Zod parse the body. At least one of role or is_active must be present
//      (refine on the schema). Empty body returns 422.
//   3. Resolve the target membership row scoped to caller.orgId. Cross-tenant
//      and unknown user_id both surface as 404 per the constitutional
//      Pattern A workflow-POST rule (we hide non-membership existence).
//   4. Self-deactivate guard: if caller is patching their own row to
//      is_active=false, return 422 CANNOT_DEACTIVATE_SELF. An operator who
//      wants to leave their own org must use a different surface (out of
//      scope for v1).
//   5. Privilege-escalation guard: if caller's role is org_admin AND the
//      requested role is org_owner, return 403 FORBIDDEN_ROLE_ESCALATION.
//      Only an existing org_owner can mint another org_owner. Mirrors the
//      guard in postInviteStaffMember.
//   6. Resolve the requested role's id (when role is part of the body) so
//      we can update the foreign key. Unknown role_code -> 500 (the Zod
//      schema already restricted the surface to staff codes, so an unknown
//      code here means roles seed drift, not a client bug).
//   7. UPDATE org_memberships and return the projected row in the same shape
//      listOrgMembers emits. The audit trigger extended in migration 0068
//      fires AFTER UPDATE inside the same transaction and emits an
//      action='updated' audit row with from_state/to_state set to the
//      is_active transition (or both equal when only role changed).
//
// Idempotency: respondWithIdempotency wraps the side-effecting block so a
// re-clicked button (same key + same body) replays without firing another
// UPDATE.
// ---------------------------------------------------------------------------

async function patchOrgMember(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'org.member.update');
  parseUuidParam(ctx.params.user_id, 'user_id');
  const targetUserId = ctx.params.user_id;
  const body = await parseBody(ctx.req, PatchOrgMemberRequestSchema);

  // Self-deactivate guard. The caller can change their own role (e.g. an
  // org_owner stepping themselves down to org_admin) but cannot mark their
  // own row inactive; doing so would lock them out of the org. Surfaced
  // as 422 with a domain-specific code so the SPA can render a precise
  // toast rather than a generic FORBIDDEN.
  if (body.is_active === false && targetUserId === caller.userId) {
    throw new ApiError(
      'CANNOT_DEACTIVATE_SELF',
      422,
      'You cannot deactivate your own membership.',
    );
  }

  // Privilege-escalation guard. An org_admin cannot promote a peer to
  // org_owner; only an existing org_owner can mint another owner. Same
  // posture as postInviteStaffMember above.
  if (body.role === 'org_owner' && caller.role !== 'org_owner') {
    throw new ApiError(
      'FORBIDDEN_ROLE_ESCALATION',
      403,
      'Only an org owner can promote another member to org owner.',
    );
  }

  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    '/members/:user_id',
    body,
    async () => {
      const sb = admin();

      // Resolve the target membership scoped to caller.orgId. Missing row
      // (cross-tenant or unknown user_id) surfaces as 404 per Pattern A so
      // we never leak whether a user_id exists in another org.
      const targetQ = await sb
        .from('org_memberships')
        .select('id, user_id, org_id, role_id, is_active')
        .eq('user_id', targetUserId)
        .eq('org_id', caller.orgId)
        .maybeSingle();
      if (targetQ.error) {
        throw internalError('auth-api:membership_lookup_failed', targetQ.error);
      }
      if (!targetQ.data) {
        throw new ApiError('NOT_FOUND', 404, 'Member not found.');
      }

      // Resolve role_id when role was supplied. The Zod schema already
      // restricted the value to a staff code; an unresolved id here means
      // the roles seed has drifted and is a 500 condition.
      const patch: Record<string, unknown> = {
        updated_by: caller.userId,
        updated_at: new Date().toISOString(),
      };
      if (body.role !== undefined) {
        const roleQ = await sb
          .from('roles')
          .select('id, code')
          .eq('code', body.role)
          .maybeSingle();
        if (roleQ.error) {
          throw internalError('auth-api:role_lookup_failed', roleQ.error);
        }
        const roleRow = roleQ.data as { id: string; code: string } | null;
        if (!roleRow) {
          throw new ApiError(
            'INTERNAL_ERROR',
            500,
            `role ${body.role} missing from roles table`,
          );
        }
        patch.role_id = roleRow.id;
      }
      if (body.is_active !== undefined) {
        patch.is_active = body.is_active;
      }

      const updateQ = await sb
        .from('org_memberships')
        .update(patch)
        .eq('user_id', targetUserId)
        .eq('org_id', caller.orgId);
      if (updateQ.error) {
        throw internalError('auth-api:membership_update_failed', updateQ.error);
      }

      // Re-read so the response carries the same shape listOrgMembers emits.
      // Joins roles for code + label; pulls email + display_name from
      // profiles; resolves email_confirmed_at via auth.admin.getUserById so
      // the SPA Resend button gate stays consistent across list and patch
      // responses.
      const reReadQ = await sb
        .from('org_memberships')
        .select(
          `
          user_id,
          org_id,
          is_active,
          created_at,
          role:roles!inner(code, label)
        `,
        )
        .eq('user_id', targetUserId)
        .eq('org_id', caller.orgId)
        .maybeSingle();
      if (reReadQ.error || !reReadQ.data) {
        throw internalError('auth-api:post_update_re_read_failed', reReadQ.error);
      }
      type ReRead = {
        user_id: string;
        org_id: string;
        is_active: boolean;
        created_at: string;
        role:
          | { code: string; label: string }
          | { code: string; label: string }[]
          | null;
      };
      const row = reReadQ.data as ReRead;
      const role = Array.isArray(row.role) ? row.role[0] : row.role;
      if (!role) {
        throw new ApiError(
          'INTERNAL_ERROR',
          500,
          'role missing from post-update re-read',
        );
      }

      const profileQ = await sb
        .from('profiles')
        .select('email, display_name')
        .eq('user_id', targetUserId)
        .maybeSingle();
      if (profileQ.error || !profileQ.data) {
        throw internalError('auth-api:profile_lookup_failed', profileQ.error);
      }
      const profile = profileQ.data as {
        email: string | null;
        display_name: string | null;
      };
      if (!profile.email) {
        throw new ApiError(
          'INTERNAL_ERROR',
          500,
          'profile email missing for updated member',
        );
      }

      let claimed = true;
      const { data: authData, error: authErr } =
        await sb.auth.admin.getUserById(targetUserId);
      if (authErr) {
        console.warn('auth-api: getUserById failed during patch re-read', {
          org_id: caller.orgId,
          user_id: targetUserId,
          message: authErr.message,
        });
      } else {
        const confirmed =
          (authData?.user as { email_confirmed_at?: string | null } | undefined)
            ?.email_confirmed_at ?? null;
        claimed = confirmed !== null;
      }

      const out: OrgMemberRow = {
        user_id: row.user_id,
        org_id: row.org_id,
        email: profile.email,
        display_name: profile.display_name,
        role_code: role.code as OrgMemberRow['role_code'],
        role_display_name: role.label,
        created_at: row.created_at,
        is_active: row.is_active,
        claimed,
      };
      return ok(OrgMemberRowSchema.parse(out));
    },
  );
}

// ---------------------------------------------------------------------------
// POST /members/:user_id/resend
//
// Re-issues a fresh magic link to an invited teammate who never claimed the
// original. Closes F-Wave9-STAFF-INVITE-RESEND-01 backend.
//
// Flow:
//   1. requireCap('org.member.resend') gates the route. Granted to org_owner
//      and org_admin only.
//   2. Resolve the target membership scoped to caller.orgId. Cross-tenant or
//      unknown user_id -> 404 (Pattern A).
//   3. Resolve target email via auth.admin.getUserById. If the auth row is
//      missing -> 500 (it should always exist when the membership row does).
//   4. If email_confirmed_at is set, return 422 MEMBER_ALREADY_CLAIMED.
//      Re-issuing a magic link to a fully signed-in account does nothing
//      useful and risks misleading the operator into thinking a stuck
//      teammate just needs another email.
//   5. supabase.auth.admin.generateLink({ type: 'magiclink' }) produces a
//      fresh single-use sign-in URL. Mirrors the customer portal invite
//      pattern from crm-api inviteCustomerToPortal (PR #91) and the initial
//      staff invite (postInviteStaffMember above).
//   6. Queue a branded resend email through the notifications chassis. The
//      5-minute drain cron ships it via Resend. Notification queue failure
//      is LOGGED but does not unwind the resend (mirrors the invite
//      handler's posture); the operator can re-click Resend to retry.
//   7. Response: { status: 'sent', resent_at: <iso8601> }. The action_link
//      is intentionally NOT echoed to the caller; it goes to the invitee's
//      inbox only.
//
// Idempotency: respondWithIdempotency wraps the side-effecting block so a
// re-clicked button (same key) replays without re-generating the link or
// re-queueing the email.
// ---------------------------------------------------------------------------

async function resendOrgMemberInvite(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'org.member.resend');
  parseUuidParam(ctx.params.user_id, 'user_id');
  const targetUserId = ctx.params.user_id;

  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    '/members/:user_id/resend',
    null,
    async () => {
      const sb = admin();

      // Resolve the target membership scoped to caller.orgId. Pattern A.
      const targetQ = await sb
        .from('org_memberships')
        .select('id, user_id, org_id, role:roles!inner(code)')
        .eq('user_id', targetUserId)
        .eq('org_id', caller.orgId)
        .maybeSingle();
      if (targetQ.error) {
        throw internalError('auth-api:membership_lookup_failed', targetQ.error);
      }
      if (!targetQ.data) {
        throw new ApiError('NOT_FOUND', 404, 'Member not found.');
      }
      type TargetRow = {
        id: string;
        user_id: string;
        org_id: string;
        role: { code: string } | { code: string }[] | null;
      };
      const target = targetQ.data as TargetRow;
      const roleObj = Array.isArray(target.role) ? target.role[0] : target.role;
      const targetRoleCode = roleObj?.code ?? 'viewer';

      // Resolve the invitee's auth.users row. We need email + the
      // email_confirmed_at signal so we can refuse a resend to an already-
      // claimed account.
      const { data: authData, error: authErr } =
        await sb.auth.admin.getUserById(targetUserId);
      if (authErr || !authData?.user) {
        throw internalError('auth-api:auth_user_lookup_failed', authErr);
      }
      const authUser = authData.user as {
        id: string;
        email: string;
        email_confirmed_at?: string | null;
      };
      if (!authUser.email) {
        throw new ApiError(
          'INTERNAL_ERROR',
          500,
          'auth user has no email; cannot resend invite',
        );
      }
      if (authUser.email_confirmed_at) {
        throw new ApiError(
          'MEMBER_ALREADY_CLAIMED',
          422,
          'This member has already claimed their invite and signed in.',
        );
      }

      // Generate a fresh magic link. Same redirect as the initial invite
      // so the recipient lands on the dashboard after sign-in.
      const linkResult = await sb.auth.admin.generateLink({
        type: 'magiclink',
        email: authUser.email,
        options: { redirectTo: STAFF_INVITE_REDIRECT_URL },
      });
      if (linkResult.error || !linkResult.data?.properties?.action_link) {
        throw new ApiError(
          'AUTH_ERROR',
          422,
          'Could not generate invite link.',
          { detail: linkResult.error?.message },
        );
      }
      const actionLink = linkResult.data.properties.action_link;

      // Resolve the org display name for the resend email subject + body.
      // Fall back to 'Kitstak' if the lookup fails so a transient error
      // does not block the resend.
      let orgDisplayName = 'Kitstak';
      const { data: orgRow, error: orgLookupErr } = await sb
        .from('organizations')
        .select('display_name')
        .eq('id', caller.orgId)
        .maybeSingle();
      if (orgLookupErr) {
        console.error('auth-api: failed to resolve org display_name for resend', {
          org_id: caller.orgId,
          message: orgLookupErr.message,
        });
      } else if (orgRow && typeof orgRow.display_name === 'string') {
        orgDisplayName = orgRow.display_name;
      }

      // Queue the branded resend email through the notifications chassis.
      // Copy is intentionally close to the original invite so the recipient
      // recognises it as a reminder rather than a separate workflow.
      const subject = `Reminder: your invitation to join ${orgDisplayName}`;
      const emailBody =
        `You were invited to join ${orgDisplayName} on Kitstak ` +
        'and have not signed in yet.\n\n' +
        'Click the link below to accept the invitation and sign in.\n\n' +
        `${actionLink}\n\n` +
        'This link expires in 24 hours.';
      const { error: notifErr } = await sb.from('notifications').insert({
        org_id: caller.orgId,
        recipient_user_id: targetUserId,
        channel: 'email',
        subject,
        body: emailBody,
        payload: {
          to: authUser.email,
          type: 'staff_invite_resend',
          role: targetRoleCode,
        },
        created_by: caller.userId,
        updated_by: caller.userId,
      });
      if (notifErr) {
        console.error('auth-api: failed to queue staff-invite resend email', {
          org_id: caller.orgId,
          message: notifErr.message,
        });
      }

      const resentAt = new Date().toISOString();
      return ok(
        ResendOrgMemberInviteResponseSchema.parse({
          status: 'sent' as const,
          resent_at: resentAt,
        }),
      );
    },
  );
}

Deno.serve((req: Request) =>
  route(
    req,
    [
      { method: 'GET',   path: '/me',                              handler: getMe },
      { method: 'GET',   path: '/me/capabilities',                 handler: (ctx) => Promise.resolve(getMyCapabilities(ctx)) },
      { method: 'POST',  path: '/sessions/switch-org',             handler: postSwitchOrg },
      { method: 'GET',   path: '/members',                         handler: listOrgMembers },
      { method: 'POST',  path: '/members/invite',                  handler: postInviteStaffMember },
      { method: 'PATCH', path: '/members/:user_id',                handler: patchOrgMember },
      { method: 'POST',  path: '/members/:user_id/resend',         handler: resendOrgMemberInvite },
      { method: 'POST',  path: '/portal/request-signin-link',      handler: postRequestSignInLink },
      { method: 'POST',  path: '/auth/request-password-reset',     handler: postRequestPasswordReset },
    ],
    { bundle: BUNDLE },
  ),
);
