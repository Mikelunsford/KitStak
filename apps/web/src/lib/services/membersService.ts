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
  OrgMembersListResponseSchema,
  type InviteStaffRequest,
  type InviteStaffResponse,
  type OrgMemberRow,
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
