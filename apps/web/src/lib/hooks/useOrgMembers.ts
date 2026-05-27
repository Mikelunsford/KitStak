// useOrgMembers. TanStack Query wrapper over membersService.listOrgMembers.
//
// F-Wave9-STAFF-INVITE-MEMBERS-LIST-01: replaces the v1 /admin/members
// stub (which only showed the caller's own row from /me) with a real list
// backed by GET /auth-api/members.
//
// Key shape: ['identity', 'members', 'list', { org_id }]. Scoping by org_id
// means a workspace switch evicts cleanly without a manual invalidate; the
// active org id flows in via the caller's argument so the hook stays a pure
// adapter over the service.
//
// Stale time follows the constitutional default (30s). Refetch on window
// focus is off; the invite mutation already invalidates this key via
// membersKeys.all in useMembers.ts, so a paste-and-send invite cycle on the
// /admin/members page reflects the new row immediately without leaning on
// focus-revalidation.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { membersKeys } from '@/lib/queryKeys/members';
import {
  listOrgMembers,
  patchOrgMember,
  resendOrgMemberInvite,
} from '@/lib/services/membersService';
import type {
  OrgMemberRow,
  PatchOrgMemberRequest,
  ResendOrgMemberInviteResponse,
} from '@/lib/types/identity';

interface UseOrgMembersOptions {
  /**
   * Active org id. Passed in so the query key includes it and a workspace
   * switch evicts the prior org's data cleanly. The /admin/members page
   * pulls this from the caller's useMe() payload (active_org_id).
   *
   * When null or undefined the query stays disabled; this matches the
   * pattern used by other org-scoped hooks (the route guard already
   * ensures a present org claim before MembersPage mounts, so the disabled
   * branch is defence in depth).
   */
  orgId: string | null | undefined;
}

export function useOrgMembers(opts: UseOrgMembersOptions) {
  const { orgId } = opts;
  return useQuery<OrgMemberRow[]>({
    queryKey: membersKeys.list({ org_id: orgId ?? '' }),
    queryFn: listOrgMembers,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: 1,
    enabled: Boolean(orgId),
  });
}

/**
 * PATCH /auth-api/members/:user_id. Per-row role change and deactivate /
 * reactivate from the team-members list. Invalidates the members list
 * query on success so the updated row reflects without a manual refresh.
 *
 * F-Wave9-STAFF-INVITE-PATCH-01.
 */
export function useUpdateOrgMember(userId: string) {
  const qc = useQueryClient();
  return useMutation<OrgMemberRow, Error, PatchOrgMemberRequest>({
    mutationFn: (body) => patchOrgMember(userId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: membersKeys.all });
    },
  });
}

/**
 * POST /auth-api/members/:user_id/resend. Re-issue a fresh magic link to
 * an invited teammate who has not yet claimed. Invalidates the members
 * list on success so any UX surface that wants to render a "last resent
 * at" timestamp can pick up a fresh row.
 *
 * F-Wave9-STAFF-INVITE-RESEND-01.
 */
export function useResendOrgMemberInvite(userId: string) {
  const qc = useQueryClient();
  return useMutation<ResendOrgMemberInviteResponse, Error, void>({
    mutationFn: () => resendOrgMemberInvite(userId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: membersKeys.all });
    },
  });
}
