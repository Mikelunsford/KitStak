// KitForce query keys factory. Pillar 4 (labor / workforce).
//
// Keyed roots: members, teams, team-members (child of a team), shifts,
// assignments, time-entries.
//
// auditLogKeys.byEntity('workforce_member' | 'workforce_team' | 'shift' |
// 'work_assignment' | 'time_entry', id) is owned by the audit_log factory and is
// invalidated alongside these on mutation success.

import type {
  ListMembersFilters,
  ListShiftsFilters,
  ListAssignmentsFilters,
  ListTimeEntriesFilters,
} from '@/lib/services/kitforceService';

export const membersKeys = {
  all: ['kitforce', 'members'] as const,
  list: (filters: ListMembersFilters = {}) =>
    [...membersKeys.all, 'list', filters] as const,
  detail: (id: string) =>
    [...membersKeys.all, 'detail', id] as const,
};

export const teamsKeys = {
  all: ['kitforce', 'teams'] as const,
  list: () => [...teamsKeys.all, 'list'] as const,
  detail: (id: string) =>
    [...teamsKeys.all, 'detail', id] as const,
  members: (id: string) =>
    [...teamsKeys.all, 'detail', id, 'members'] as const,
};

export const shiftsKeys = {
  all: ['kitforce', 'shifts'] as const,
  list: (filters: ListShiftsFilters = {}) =>
    [...shiftsKeys.all, 'list', filters] as const,
  detail: (id: string) =>
    [...shiftsKeys.all, 'detail', id] as const,
};

export const assignmentsKeys = {
  all: ['kitforce', 'assignments'] as const,
  list: (filters: ListAssignmentsFilters = {}) =>
    [...assignmentsKeys.all, 'list', filters] as const,
  detail: (id: string) =>
    [...assignmentsKeys.all, 'detail', id] as const,
};

export const timeEntriesKeys = {
  all: ['kitforce', 'time-entries'] as const,
  list: (filters: ListTimeEntriesFilters = {}) =>
    [...timeEntriesKeys.all, 'list', filters] as const,
  detail: (id: string) =>
    [...timeEntriesKeys.all, 'detail', id] as const,
};
