/**
 * Members service. Thin wrappers over the auth-api /members routes.
 *
 * Schemas come from @/lib/types/identity which is the SPA-side byte-mirror
 * of supabase/functions/_shared/types/identity.ts. The byte parity contract
 * test in apps/web/test/contract/parity.test.ts gates any drift between the
 * two copies; any change here must land in both files in the same commit.
 *
 * F-Wave9-STAFF-INVITE-CHASSIS-01: ships the SPA half of the staff-invite
 * chassis. The backend half (RPC + Edge handler) lands in a parallel PR
 * against the same Zod schemas. Both sides parse the wire envelope through
 * InviteStaffResponseSchema so a drift surfaces as a Zod ParseError on the
 * SPA boundary instead of a silent TypeScript any-cast.
 */

import { apiRequest } from '@/lib/apiClient';
import {
  InviteStaffResponseSchema,
  OrgMemberRowSchema,
  OrgMembersListResponseSchema,
  ResendOrgMemberInviteResponseSchema,
  type InviteStaffRequest,
  type InviteStaffResponse,
  type OrgMemberRow,
  type PatchOrgMemberRequest,
  type ResendOrgMemberInviteResponse,
} from '@/lib/types/identity';

export async function inviteStaffMember(
  body: InviteStaffRequest,
): Promise<InviteStaffResponse> {
  const data = await apiRequest<unknown>('/auth-api/members/invite', {
    method: 'POST',
    body,
  });
  return InviteStaffResponseSchema.parse(data);
}

/**
 * GET /auth-api/members. Returns the active staff memberships in the
 * caller's org. Flat array, no pagination (orgs are expected to have well
 * under 50 staff for the first year). Cross-tenant queries return the
 * caller's own org rows per the constitutional Pattern A read posture.
 *
 * F-Wave9-STAFF-INVITE-MEMBERS-LIST-01.
 */
export async function listOrgMembers(): Promise<OrgMemberRow[]> {
  const data = await apiRequest<unknown>('/auth-api/members', {
    method: 'GET',
  });
  return OrgMembersListResponseSchema.parse(data);
}

/**
 * PATCH /auth-api/members/:user_id. Per-row role change + deactivate or
 * reactivate. The caller's own row is excluded by the SPA action menu so
 * the self-deactivate 422 from the backend only fires on a misuse path.
 *
 * F-Wave9-STAFF-INVITE-PATCH-01.
 */
export async function patchOrgMember(
  userId: string,
  body: PatchOrgMemberRequest,
): Promise<OrgMemberRow> {
  const data = await apiRequest<unknown>(
    `/auth-api/members/${encodeURIComponent(userId)}`,
    {
      method: 'PATCH',
      body,
    },
  );
  return OrgMemberRowSchema.parse(data);
}

/**
 * POST /auth-api/members/:user_id/resend. Re-issue a fresh magic link to a
 * teammate who never claimed the original. The backend refuses already-
 * claimed accounts with 422 MEMBER_ALREADY_CLAIMED so the SPA only renders
 * the Resend button on rows where claimed=false.
 *
 * F-Wave9-STAFF-INVITE-RESEND-01.
 */
export async function resendOrgMemberInvite(
  userId: string,
): Promise<ResendOrgMemberInviteResponse> {
  const data = await apiRequest<unknown>(
    `/auth-api/members/${encodeURIComponent(userId)}/resend`,
    {
      method: 'POST',
      body: {},
    },
  );
  return ResendOrgMemberInviteResponseSchema.parse(data);
}
