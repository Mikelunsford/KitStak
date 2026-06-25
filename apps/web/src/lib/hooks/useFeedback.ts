// TanStack Query hooks for the internal feedback / support-ticketing surfaces
// (migration 0140). Tenant hooks back the tester's own ticket list, detail,
// thread, create, and reply. Staff hooks back the cross-tenant inbox, detail,
// full thread (with internal notes), status/priority update, and staff reply.
// useIsPlatformStaff() reads GET /me once (high staleTime) to decide whether
// to surface the staff inbox at all.
//
// All reads inherit the QueryClient defaults (staleTime 30_000,
// refetchOnWindowFocus false, retry 1); QUERY_DEFAULTS is spread for
// consistency per queryDefaults.ts. Mutations invalidate the affected keys.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { feedbackKeys } from '@/lib/queryKeys/feedback';
import {
  createTicket,
  listMyTickets,
  getTicket,
  listTicketComments,
  addTicketComment,
  getPlatformStaff,
  listStaffTickets,
  getStaffTicket,
  listStaffTicketComments,
  updateStaffTicket,
  addStaffTicketComment,
  type MyTicketsFilters,
  type StaffTicketsFilters,
} from '@/lib/services/feedbackService';
import type {
  SupportTicketCreateInput,
  SupportTicketCommentCreateInput,
  SupportTicketStaffUpdateInput,
  SupportTicketStaffCommentCreateInput,
} from '@/lib/types/feedback';
import { QUERY_DEFAULTS } from './queryDefaults';

// ---------------------------------------------------------------------------
// Tenant side
// ---------------------------------------------------------------------------

export function useMyTickets(filters: MyTicketsFilters = {}) {
  return useQuery({
    queryKey: feedbackKeys.myTickets({
      status: filters.status ?? null,
      type: filters.type ?? null,
    }),
    queryFn: () => listMyTickets(filters),
    ...QUERY_DEFAULTS,
  });
}

export function useTicket(id: string | undefined) {
  return useQuery({
    queryKey: feedbackKeys.ticket(id ?? '__none__'),
    queryFn: () => getTicket(id as string),
    ...QUERY_DEFAULTS,
    enabled: !!id,
  });
}

export function useTicketComments(id: string | undefined) {
  return useQuery({
    queryKey: feedbackKeys.ticketComments(id ?? '__none__'),
    queryFn: () => listTicketComments(id as string),
    ...QUERY_DEFAULTS,
    enabled: !!id,
  });
}

export function useCreateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: SupportTicketCreateInput) => createTicket(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: feedbackKeys.myTickets() });
    },
  });
}

export function useAddComment(ticketId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: SupportTicketCommentCreateInput) =>
      addTicketComment(ticketId, payload),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: feedbackKeys.ticketComments(ticketId),
      });
      void qc.invalidateQueries({ queryKey: feedbackKeys.ticket(ticketId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Staff side
// ---------------------------------------------------------------------------

/**
 * Whether the caller is on the platform-staff allowlist. Reads GET
 * /feedback-admin-api/me, which never 403s. Cached with a long stale window
 * since staff membership rarely changes within a session. The boolean gates
 * the staff inbox nav link and page; the server remains the authority on the
 * underlying data calls.
 */
export function useIsPlatformStaff() {
  return useQuery({
    queryKey: feedbackKeys.platformStaff,
    queryFn: getPlatformStaff,
    ...QUERY_DEFAULTS,
    staleTime: 5 * 60_000,
  });
}

export function useStaffTickets(filters: StaffTicketsFilters = {}) {
  return useQuery({
    queryKey: feedbackKeys.staffTickets({
      status: filters.status ?? null,
      type: filters.type ?? null,
      org_id: filters.org_id ?? null,
    }),
    queryFn: () => listStaffTickets(filters),
    ...QUERY_DEFAULTS,
  });
}

export function useStaffTicket(id: string | undefined) {
  return useQuery({
    queryKey: feedbackKeys.staffTicket(id ?? '__none__'),
    queryFn: () => getStaffTicket(id as string),
    ...QUERY_DEFAULTS,
    enabled: !!id,
  });
}

export function useStaffTicketComments(id: string | undefined) {
  return useQuery({
    queryKey: feedbackKeys.staffTicketComments(id ?? '__none__'),
    queryFn: () => listStaffTicketComments(id as string),
    ...QUERY_DEFAULTS,
    enabled: !!id,
  });
}

export function useUpdateTicketStaff(ticketId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: SupportTicketStaffUpdateInput) =>
      updateStaffTicket(ticketId, payload),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: feedbackKeys.staffTicket(ticketId),
      });
      void qc.invalidateQueries({ queryKey: feedbackKeys.staffTickets() });
    },
  });
}

export function useAddStaffComment(ticketId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: SupportTicketStaffCommentCreateInput) =>
      addStaffTicketComment(ticketId, payload),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: feedbackKeys.staffTicketComments(ticketId),
      });
      void qc.invalidateQueries({
        queryKey: feedbackKeys.staffTicket(ticketId),
      });
    },
  });
}
