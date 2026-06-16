// KitForce TanStack Query hooks. Pillar 4 (labor / workforce).
//
// Mirrors the useCoPack.ts canon:
//   - C = { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } per the
//     SPA constitution defaults.
//   - Every state-changing mutation invalidates the relevant entity keys AND
//     auditLogKeys.byEntity(entityType, id). The DB writes audit_log rows on
//     state transitions; SPA must invalidate the timeline so the operator sees
//     the entry without refresh.
//   - Mutation hooks return the `mutation` object (callers use mutation.error
//     for inline rendering).
//
// Three parents carry state machines (workforce_members, shifts,
// work_assignments); workforce_teams is a flat library; time_entries is a
// line-item-class table.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { track } from '@/lib/analytics';
import { buildLaborTimeClockedProps } from '@/lib/hooks/pillarAnalytics';
import { auditLogKeys } from '@/lib/queryKeys/auditLog';
import {
  membersKeys,
  teamsKeys,
  shiftsKeys,
  assignmentsKeys,
  timeEntriesKeys,
} from '@/lib/queryKeys/kitforce';
import {
  listMembers, getMember, createMember, updateMember,
  deactivateMember, reactivateMember,
  listTeams, createTeam, updateTeam,
  listTeamMembers, addTeamMember, removeTeamMember,
  listShifts, getShift, createShift, updateShift,
  startShift, completeShift, cancelShift,
  listAssignments, getAssignment, createAssignment, updateAssignment,
  assignAssignment, startAssignment, completeAssignment, cancelAssignment,
  listTimeEntries, clockInTimeEntry, clockOutTimeEntry, updateTimeEntry,
  deleteTimeEntry,
  type ListMembersFilters,
  type WorkforceMemberCreate,
  type WorkforceMemberPatch,
  type WorkforceTeamCreate,
  type WorkforceTeamPatch,
  type WorkforceTeamMemberCreate,
  type ListShiftsFilters,
  type ShiftCreate,
  type ShiftPatch,
  type ListAssignmentsFilters,
  type WorkAssignmentCreate,
  type WorkAssignmentPatch,
  type ListTimeEntriesFilters,
  type TimeEntryClockIn,
  type TimeEntryClockOut,
  type TimeEntryPatch,
  type KitForceTransitionRequest,
} from '@/lib/services/kitforceService';

const C = { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 as const };

// ===========================================================================
// workforce_members (parent, state machine)
// ===========================================================================

export function useMembersList(filters: ListMembersFilters = {}) {
  return useQuery({
    queryKey: membersKeys.list(filters),
    queryFn: () => listMembers(filters),
    ...C,
  });
}

export function useMember(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? membersKeys.detail(id)
      : ['kitforce', 'members', 'detail', 'noop'],
    queryFn: () => getMember(id as string),
    enabled: !!id,
    ...C,
  });
}

export function useCreateMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: WorkforceMemberCreate) => createMember(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: membersKeys.all });
    },
  });
}

export function useUpdateMember(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: WorkforceMemberPatch) => updateMember(id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: membersKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('workforce_member', id) });
    },
  });
}

export function useDeactivateMember(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: KitForceTransitionRequest = {}) => deactivateMember(id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: membersKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('workforce_member', id) });
    },
  });
}

export function useReactivateMember(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: KitForceTransitionRequest = {}) => reactivateMember(id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: membersKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('workforce_member', id) });
    },
  });
}

// ===========================================================================
// workforce_teams (library) + team members (join)
// ===========================================================================

export function useTeamsList() {
  return useQuery({
    queryKey: teamsKeys.list(),
    queryFn: () => listTeams(),
    ...C,
  });
}

export function useCreateTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: WorkforceTeamCreate) => createTeam(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: teamsKeys.all });
    },
  });
}

export function useUpdateTeam(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: WorkforceTeamPatch) => updateTeam(id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: teamsKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('workforce_team', id) });
    },
  });
}

export function useTeamMembers(teamId: string | undefined) {
  return useQuery({
    queryKey: teamId
      ? teamsKeys.members(teamId)
      : ['kitforce', 'teams', 'detail', '__none__', 'members'],
    queryFn: () => listTeamMembers(teamId as string),
    enabled: !!teamId,
    ...C,
  });
}

export function useAddTeamMember(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: WorkforceTeamMemberCreate) => addTeamMember(teamId, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: teamsKeys.members(teamId) });
      void qc.invalidateQueries({ queryKey: teamsKeys.detail(teamId) });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('workforce_team', teamId) });
    },
  });
}

export function useRemoveTeamMember(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string) => removeTeamMember(teamId, memberId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: teamsKeys.members(teamId) });
      void qc.invalidateQueries({ queryKey: teamsKeys.detail(teamId) });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('workforce_team', teamId) });
    },
  });
}

// ===========================================================================
// shifts (parent, state machine)
// ===========================================================================

export function useShiftsList(filters: ListShiftsFilters = {}) {
  return useQuery({
    queryKey: shiftsKeys.list(filters),
    queryFn: () => listShifts(filters),
    ...C,
  });
}

export function useShift(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? shiftsKeys.detail(id)
      : ['kitforce', 'shifts', 'detail', 'noop'],
    queryFn: () => getShift(id as string),
    enabled: !!id,
    ...C,
  });
}

export function useCreateShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ShiftCreate) => createShift(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: shiftsKeys.all });
    },
  });
}

export function useUpdateShift(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ShiftPatch) => updateShift(id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: shiftsKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('shift', id) });
    },
  });
}

export function useStartShift(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: KitForceTransitionRequest = {}) => startShift(id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: shiftsKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('shift', id) });
    },
  });
}

export function useCompleteShift(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: KitForceTransitionRequest = {}) => completeShift(id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: shiftsKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('shift', id) });
    },
  });
}

export function useCancelShift(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: KitForceTransitionRequest = {}) => cancelShift(id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: shiftsKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('shift', id) });
    },
  });
}

// ===========================================================================
// work_assignments (parent, state machine)
// ===========================================================================

export function useAssignmentsList(filters: ListAssignmentsFilters = {}) {
  return useQuery({
    queryKey: assignmentsKeys.list(filters),
    queryFn: () => listAssignments(filters),
    ...C,
  });
}

export function useAssignment(id: string | undefined) {
  return useQuery({
    queryKey: id
      ? assignmentsKeys.detail(id)
      : ['kitforce', 'assignments', 'detail', 'noop'],
    queryFn: () => getAssignment(id as string),
    enabled: !!id,
    ...C,
  });
}

export function useCreateAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: WorkAssignmentCreate) => createAssignment(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: assignmentsKeys.all });
    },
  });
}

export function useUpdateAssignment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: WorkAssignmentPatch) => updateAssignment(id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: assignmentsKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('work_assignment', id) });
    },
  });
}

export function useAssignAssignment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: WorkAssignmentPatch = {}) => assignAssignment(id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: assignmentsKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('work_assignment', id) });
    },
  });
}

export function useStartAssignment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: KitForceTransitionRequest = {}) => startAssignment(id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: assignmentsKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('work_assignment', id) });
    },
  });
}

export function useCompleteAssignment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: KitForceTransitionRequest = {}) => completeAssignment(id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: assignmentsKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('work_assignment', id) });
    },
  });
}

export function useCancelAssignment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: KitForceTransitionRequest = {}) => cancelAssignment(id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: assignmentsKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('work_assignment', id) });
    },
  });
}

// ===========================================================================
// time_entries (line-item-class)
// ===========================================================================

export function useTimeEntriesList(filters: ListTimeEntriesFilters = {}) {
  return useQuery({
    queryKey: timeEntriesKeys.list(filters),
    queryFn: () => listTimeEntries(filters),
    ...C,
  });
}

export function useClockInTimeEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TimeEntryClockIn) => clockInTimeEntry(input),
    onSuccess: (entry) => {
      void qc.invalidateQueries({ queryKey: timeEntriesKeys.all });
      // R-W13-OBS-01: emit the KitForce labor funnel event on clock-in. The
      // entry id and member id are opaque UUIDs; no names, hours, or rate.
      track(
        'labor_time_clocked',
        buildLaborTimeClockedProps(entry.id, 'clock_in', entry.member_id ?? null),
      );
    },
  });
}

export function useClockOutTimeEntry(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TimeEntryClockOut) => clockOutTimeEntry(id, input),
    onSuccess: (entry) => {
      void qc.invalidateQueries({ queryKey: timeEntriesKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('time_entry', id) });
      // R-W13-OBS-01: emit the KitForce labor funnel event on clock-out. The
      // entry id and member id are opaque UUIDs; no names, minutes, or rate.
      track(
        'labor_time_clocked',
        buildLaborTimeClockedProps(entry.id, 'clock_out', entry.member_id ?? null),
      );
    },
  });
}

export function useUpdateTimeEntry(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TimeEntryPatch) => updateTimeEntry(id, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: timeEntriesKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('time_entry', id) });
    },
  });
}

export function useDeleteTimeEntry(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => deleteTimeEntry(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: timeEntriesKeys.all });
      void qc.invalidateQueries({ queryKey: auditLogKeys.byEntity('time_entry', id) });
    },
  });
}
