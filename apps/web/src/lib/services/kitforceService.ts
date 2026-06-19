// KitForce service. Lives under bundle-gated kitforce-api. Pillar 4 (labor).
//
// The edge function bundle gates on plugins.kitforce and returns 404 for orgs
// that lack the flag (constitution rule: bundle gate off -> 404). The metered
// add-on entitlement addons.kitforce is enforced at the billing layer and a
// missing entitlement returns the same 404 envelope.
// The Idempotency-Key header is auto-injected by apiClient for non-GET.
//
// Three parents carry state machines (workforce_members, shifts,
// work_assignments); workforce_teams is a flat library; time_entries is a
// line-item-class table with no parent FSM. Reads are RLS-only. Labor rate
// fields are stripped server-side for roles lacking kitforce.member.read_rate
// (DECIDED C2); the SPA mirrors that for display only.

import { apiRequest, apiRequestWithMeta } from '@/lib/apiClient';
import { serverListQs, metaCursor, type ServerListParams } from '@/lib/services/serverListQs';
import {
  WorkforceMemberSchema,
  WorkforceTeamSchema,
  WorkforceTeamMemberSchema,
  ShiftSchema,
  WorkAssignmentSchema,
  TimeEntrySchema,
  type WorkforceMember,
  type WorkforceMemberStatus,
  type WorkforceMemberCreate,
  type WorkforceMemberPatch,
  type WorkforceTeam,
  type WorkforceTeamCreate,
  type WorkforceTeamPatch,
  type WorkforceTeamMember,
  type WorkforceTeamMemberCreate,
  type Shift,
  type ShiftStatus,
  type ShiftCreate,
  type ShiftPatch,
  type WorkAssignment,
  type WorkAssignmentStatus,
  type WorkAssignmentJobType,
  type WorkAssignmentCreate,
  type WorkAssignmentPatch,
  type TimeEntry,
  type TimeEntryClockIn,
  type TimeEntryClockOut,
  type TimeEntryPatch,
  type KitForceTransitionRequest,
} from '@/lib/types/kitforce';

export type {
  WorkforceMember,
  WorkforceMemberStatus,
  WorkforceMemberCreate,
  WorkforceMemberPatch,
  WorkforceTeam,
  WorkforceTeamCreate,
  WorkforceTeamPatch,
  WorkforceTeamMember,
  WorkforceTeamMemberCreate,
  Shift,
  ShiftStatus,
  ShiftCreate,
  ShiftPatch,
  WorkAssignment,
  WorkAssignmentStatus,
  WorkAssignmentJobType,
  WorkAssignmentCreate,
  WorkAssignmentPatch,
  TimeEntry,
  TimeEntryClockIn,
  TimeEntryClockOut,
  TimeEntryPatch,
  KitForceTransitionRequest,
};

const BASE = '/kitforce-api';

// Workstream C (UI scan): the server list toolbar pages read one keyset page per
// request. The kitforce-api list handlers map rows through Schema.parse (and the
// member / time-entry rate strip), returning the rows in `data` and next_cursor
// in `meta`, so the paged readers use apiRequestWithMeta + metaCursor (the
// shipments / payments shape). Each entity parses its own row array schema.
const MemberListSchema = WorkforceMemberSchema.array();
const TeamListSchema = WorkforceTeamSchema.array();
const ShiftListSchema = ShiftSchema.array();
const AssignmentListSchema = WorkAssignmentSchema.array();
const TimeEntryListSchema = TimeEntrySchema.array();

// ===========================================================================
// workforce_members (parent, state machine)
// ===========================================================================

export type ListMembersFilters = {
  status?: WorkforceMemberStatus | 'all';
};

function membersQs(f: ListMembersFilters): string {
  const p = new URLSearchParams();
  if (f.status && f.status !== 'all') p.set('status', f.status);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function listMembers(filters: ListMembersFilters = {}): Promise<WorkforceMember[]> {
  const data = await apiRequest<unknown>(`${BASE}/members${membersQs(filters)}`, { method: 'GET' });
  return (data as WorkforceMember[]).map((r) => WorkforceMemberSchema.parse(r));
}

// Workstream C: server-driven list toolbar page (search, sort, keyset).
export async function listMembersPage(
  params: ServerListParams,
): Promise<{ items: WorkforceMember[]; next_cursor: string | null }> {
  const env = await apiRequestWithMeta<unknown>(
    `${BASE}/members${serverListQs(params)}`,
    { method: 'GET' },
  );
  return { items: MemberListSchema.parse(env.data), next_cursor: metaCursor(env.meta) };
}

export async function getMember(id: string): Promise<WorkforceMember> {
  const data = await apiRequest<unknown>(`${BASE}/members/${id}`, { method: 'GET' });
  return WorkforceMemberSchema.parse(data);
}

export async function createMember(input: WorkforceMemberCreate): Promise<WorkforceMember> {
  const data = await apiRequest<unknown>(`${BASE}/members`, { method: 'POST', body: input });
  return WorkforceMemberSchema.parse(data);
}

export async function updateMember(id: string, input: WorkforceMemberPatch): Promise<WorkforceMember> {
  const data = await apiRequest<unknown>(`${BASE}/members/${id}`, { method: 'PATCH', body: input });
  return WorkforceMemberSchema.parse(data);
}

export async function deactivateMember(
  id: string, input: KitForceTransitionRequest = {},
): Promise<WorkforceMember> {
  const data = await apiRequest<unknown>(`${BASE}/members/${id}/deactivate`, { method: 'POST', body: input });
  return WorkforceMemberSchema.parse(data);
}

export async function reactivateMember(
  id: string, input: KitForceTransitionRequest = {},
): Promise<WorkforceMember> {
  const data = await apiRequest<unknown>(`${BASE}/members/${id}/reactivate`, { method: 'POST', body: input });
  return WorkforceMemberSchema.parse(data);
}

// ===========================================================================
// workforce_teams (library) + team members (join)
// ===========================================================================

export async function listTeams(): Promise<WorkforceTeam[]> {
  const data = await apiRequest<unknown>(`${BASE}/teams`, { method: 'GET' });
  return (data as WorkforceTeam[]).map((r) => WorkforceTeamSchema.parse(r));
}

// Workstream C: server-driven list toolbar page (search, sort, keyset).
export async function listTeamsPage(
  params: ServerListParams,
): Promise<{ items: WorkforceTeam[]; next_cursor: string | null }> {
  const env = await apiRequestWithMeta<unknown>(
    `${BASE}/teams${serverListQs(params)}`,
    { method: 'GET' },
  );
  return { items: TeamListSchema.parse(env.data), next_cursor: metaCursor(env.meta) };
}

export async function createTeam(input: WorkforceTeamCreate): Promise<WorkforceTeam> {
  const data = await apiRequest<unknown>(`${BASE}/teams`, { method: 'POST', body: input });
  return WorkforceTeamSchema.parse(data);
}

export async function updateTeam(id: string, input: WorkforceTeamPatch): Promise<WorkforceTeam> {
  const data = await apiRequest<unknown>(`${BASE}/teams/${id}`, { method: 'PATCH', body: input });
  return WorkforceTeamSchema.parse(data);
}

export async function listTeamMembers(teamId: string): Promise<WorkforceTeamMember[]> {
  const data = await apiRequest<unknown>(`${BASE}/teams/${teamId}/members`, { method: 'GET' });
  return (data as WorkforceTeamMember[]).map((r) => WorkforceTeamMemberSchema.parse(r));
}

export async function addTeamMember(
  teamId: string, input: WorkforceTeamMemberCreate,
): Promise<WorkforceTeamMember> {
  const data = await apiRequest<unknown>(`${BASE}/teams/${teamId}/members`, { method: 'POST', body: input });
  return WorkforceTeamMemberSchema.parse(data);
}

export async function removeTeamMember(
  teamId: string, memberId: string,
): Promise<{ id: string; deleted: boolean }> {
  return apiRequest<{ id: string; deleted: boolean }>(`${BASE}/teams/${teamId}/members/${memberId}`, { method: 'DELETE' });
}

// ===========================================================================
// shifts (parent, state machine)
// ===========================================================================

export type ListShiftsFilters = {
  status?: ShiftStatus | 'all';
  member_id?: string;
  team_id?: string;
};

function shiftsQs(f: ListShiftsFilters): string {
  const p = new URLSearchParams();
  if (f.status && f.status !== 'all') p.set('status', f.status);
  if (f.member_id) p.set('member_id', f.member_id);
  if (f.team_id) p.set('team_id', f.team_id);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function listShifts(filters: ListShiftsFilters = {}): Promise<Shift[]> {
  const data = await apiRequest<unknown>(`${BASE}/shifts${shiftsQs(filters)}`, { method: 'GET' });
  return (data as Shift[]).map((r) => ShiftSchema.parse(r));
}

// Workstream C: server-driven list toolbar page (search, sort, keyset).
export async function listShiftsPage(
  params: ServerListParams,
): Promise<{ items: Shift[]; next_cursor: string | null }> {
  const env = await apiRequestWithMeta<unknown>(
    `${BASE}/shifts${serverListQs(params)}`,
    { method: 'GET' },
  );
  return { items: ShiftListSchema.parse(env.data), next_cursor: metaCursor(env.meta) };
}

export async function getShift(id: string): Promise<Shift> {
  const data = await apiRequest<unknown>(`${BASE}/shifts/${id}`, { method: 'GET' });
  return ShiftSchema.parse(data);
}

export async function createShift(input: ShiftCreate): Promise<Shift> {
  const data = await apiRequest<unknown>(`${BASE}/shifts`, { method: 'POST', body: input });
  return ShiftSchema.parse(data);
}

export async function updateShift(id: string, input: ShiftPatch): Promise<Shift> {
  const data = await apiRequest<unknown>(`${BASE}/shifts/${id}`, { method: 'PATCH', body: input });
  return ShiftSchema.parse(data);
}

export async function startShift(id: string, input: KitForceTransitionRequest = {}): Promise<Shift> {
  const data = await apiRequest<unknown>(`${BASE}/shifts/${id}/start`, { method: 'POST', body: input });
  return ShiftSchema.parse(data);
}

export async function completeShift(id: string, input: KitForceTransitionRequest = {}): Promise<Shift> {
  const data = await apiRequest<unknown>(`${BASE}/shifts/${id}/complete`, { method: 'POST', body: input });
  return ShiftSchema.parse(data);
}

export async function cancelShift(id: string, input: KitForceTransitionRequest = {}): Promise<Shift> {
  const data = await apiRequest<unknown>(`${BASE}/shifts/${id}/cancel`, { method: 'POST', body: input });
  return ShiftSchema.parse(data);
}

// ===========================================================================
// work_assignments (parent, state machine)
// ===========================================================================

export type ListAssignmentsFilters = {
  status?: WorkAssignmentStatus | 'all';
  member_id?: string;
  job_type?: WorkAssignmentJobType;
  job_id?: string;
};

function assignmentsQs(f: ListAssignmentsFilters): string {
  const p = new URLSearchParams();
  if (f.status && f.status !== 'all') p.set('status', f.status);
  if (f.member_id) p.set('member_id', f.member_id);
  if (f.job_type) p.set('job_type', f.job_type);
  if (f.job_id) p.set('job_id', f.job_id);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function listAssignments(filters: ListAssignmentsFilters = {}): Promise<WorkAssignment[]> {
  const data = await apiRequest<unknown>(`${BASE}/assignments${assignmentsQs(filters)}`, { method: 'GET' });
  return (data as WorkAssignment[]).map((r) => WorkAssignmentSchema.parse(r));
}

// Workstream C: server-driven list toolbar page (search, sort, keyset).
export async function listAssignmentsPage(
  params: ServerListParams,
): Promise<{ items: WorkAssignment[]; next_cursor: string | null }> {
  const env = await apiRequestWithMeta<unknown>(
    `${BASE}/assignments${serverListQs(params)}`,
    { method: 'GET' },
  );
  return { items: AssignmentListSchema.parse(env.data), next_cursor: metaCursor(env.meta) };
}

export async function getAssignment(id: string): Promise<WorkAssignment> {
  const data = await apiRequest<unknown>(`${BASE}/assignments/${id}`, { method: 'GET' });
  return WorkAssignmentSchema.parse(data);
}

export async function createAssignment(input: WorkAssignmentCreate): Promise<WorkAssignment> {
  const data = await apiRequest<unknown>(`${BASE}/assignments`, { method: 'POST', body: input });
  return WorkAssignmentSchema.parse(data);
}

export async function updateAssignment(id: string, input: WorkAssignmentPatch): Promise<WorkAssignment> {
  const data = await apiRequest<unknown>(`${BASE}/assignments/${id}`, { method: 'PATCH', body: input });
  return WorkAssignmentSchema.parse(data);
}

// The assign transition may carry the member being assigned, so its body is a
// WorkAssignmentPatch (member_id optional), not the bare transition request the
// other transitions use. The server validates with WorkAssignmentPatchSchema.
export async function assignAssignment(id: string, input: WorkAssignmentPatch = {}): Promise<WorkAssignment> {
  const data = await apiRequest<unknown>(`${BASE}/assignments/${id}/assign`, { method: 'POST', body: input });
  return WorkAssignmentSchema.parse(data);
}

export async function startAssignment(id: string, input: KitForceTransitionRequest = {}): Promise<WorkAssignment> {
  const data = await apiRequest<unknown>(`${BASE}/assignments/${id}/start`, { method: 'POST', body: input });
  return WorkAssignmentSchema.parse(data);
}

export async function completeAssignment(id: string, input: KitForceTransitionRequest = {}): Promise<WorkAssignment> {
  const data = await apiRequest<unknown>(`${BASE}/assignments/${id}/complete`, { method: 'POST', body: input });
  return WorkAssignmentSchema.parse(data);
}

export async function cancelAssignment(id: string, input: KitForceTransitionRequest = {}): Promise<WorkAssignment> {
  const data = await apiRequest<unknown>(`${BASE}/assignments/${id}/cancel`, { method: 'POST', body: input });
  return WorkAssignmentSchema.parse(data);
}

// ===========================================================================
// time_entries (line-item-class, no parent state machine)
// ===========================================================================

export type ListTimeEntriesFilters = {
  member_id?: string;
  shift_id?: string;
  assignment_id?: string;
  open?: boolean;
};

function timeEntriesQs(f: ListTimeEntriesFilters): string {
  const p = new URLSearchParams();
  if (f.member_id) p.set('member_id', f.member_id);
  if (f.shift_id) p.set('shift_id', f.shift_id);
  if (f.assignment_id) p.set('assignment_id', f.assignment_id);
  if (f.open) p.set('open', 'true');
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function listTimeEntries(filters: ListTimeEntriesFilters = {}): Promise<TimeEntry[]> {
  const data = await apiRequest<unknown>(`${BASE}/time-entries${timeEntriesQs(filters)}`, { method: 'GET' });
  return (data as TimeEntry[]).map((r) => TimeEntrySchema.parse(r));
}

// Workstream C: server-driven list toolbar page (search, sort, keyset).
export async function listTimeEntriesPage(
  params: ServerListParams,
): Promise<{ items: TimeEntry[]; next_cursor: string | null }> {
  const env = await apiRequestWithMeta<unknown>(
    `${BASE}/time-entries${serverListQs(params)}`,
    { method: 'GET' },
  );
  return { items: TimeEntryListSchema.parse(env.data), next_cursor: metaCursor(env.meta) };
}

export async function clockInTimeEntry(input: TimeEntryClockIn): Promise<TimeEntry> {
  const data = await apiRequest<unknown>(`${BASE}/time-entries/clock-in`, { method: 'POST', body: input });
  return TimeEntrySchema.parse(data);
}

export async function clockOutTimeEntry(id: string, input: TimeEntryClockOut): Promise<TimeEntry> {
  const data = await apiRequest<unknown>(`${BASE}/time-entries/${id}/clock-out`, { method: 'POST', body: input });
  return TimeEntrySchema.parse(data);
}

export async function updateTimeEntry(id: string, input: TimeEntryPatch): Promise<TimeEntry> {
  const data = await apiRequest<unknown>(`${BASE}/time-entries/${id}`, { method: 'PATCH', body: input });
  return TimeEntrySchema.parse(data);
}

export async function deleteTimeEntry(id: string): Promise<{ id: string; deleted: boolean }> {
  return apiRequest<{ id: string; deleted: boolean }>(`${BASE}/time-entries/${id}`, { method: 'DELETE' });
}
