// Org-membership hooks. TanStack Query wrappers over membersService.
//
// F-Wave9-STAFF-INVITE-CHASSIS-01: the invite mutation invalidates the
// members list query so any LIST surface (currently the /admin/members
// stub) reflects the new row immediately, and invalidates the dashboard
// summary so the SetupChecklist step 8 (team_invited) ticks on the next
// dashboard visit without a manual refresh.

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { membersKeys } from '@/lib/queryKeys/members';
import { dashboardKeys } from '@/lib/queryKeys/crossCutting';
import { inviteStaffMember } from '@/lib/services/membersService';
import type {
  InviteStaffRequest,
  InviteStaffResponse,
} from '@/lib/types/identity';

/**
 * Invite a teammate to the active org. Posts to /auth-api/members/invite.
 * On success: invalidate the members list and the dashboard summary so the
 * SetupChecklist step 8 reflects the new state on the next paint.
 */
export function useInviteStaffMember() {
  const qc = useQueryClient();
  return useMutation<InviteStaffResponse, Error, InviteStaffRequest>({
    mutationFn: inviteStaffMember,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: membersKeys.all });
      void qc.invalidateQueries({ queryKey: dashboardKeys.summary() });
    },
  });
}
