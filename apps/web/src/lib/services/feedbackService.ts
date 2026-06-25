// Service layer for the internal feedback / support-ticketing feature
// (migration 0140). Wraps apiClient for both edge bundles:
//
//   - feedback-api        tenant side; a tester files and threads on their own
//                         org's tickets. RLS is the server authority.
//   - feedback-admin-api  staff side; the cross-tenant inbox, gated by
//                         is_platform_staff() plus the service role. The /me
//                         probe never 403s; it returns { platform_staff: bool }
//                         so the SPA can decide whether to render the inbox.
//
// Every response is parsed through the byte-mirror canon in
// src/lib/types/feedback.ts. List endpoints return a bare array per the API
// contract; the small unwrap() tolerates an { items } envelope too so the SPA
// does not break if a bundle wraps its list later.

import { z } from 'zod';

import { apiRequest } from '@/lib/apiClient';
import {
  SupportTicketSchema,
  SupportTicketStaffSchema,
  SupportTicketCommentSchema,
  type SupportTicket,
  type SupportTicketStaff,
  type SupportTicketComment,
  type SupportTicketCreateInput,
  type SupportTicketCommentCreateInput,
  type SupportTicketStaffUpdateInput,
  type SupportTicketStaffCommentCreateInput,
} from '@/lib/types/feedback';

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export type MyTicketsFilters = {
  status?: string;
  type?: string;
};

export type StaffTicketsFilters = {
  status?: string;
  type?: string;
  org_id?: string;
};

function ticketsQs(filters: MyTicketsFilters | StaffTicketsFilters): string {
  const p = new URLSearchParams();
  if (filters.status) p.set('status', filters.status);
  if (filters.type) p.set('type', filters.type);
  if ('org_id' in filters && filters.org_id) p.set('org_id', filters.org_id);
  const s = p.toString();
  return s ? `?${s}` : '';
}

// Tolerate either a bare array (the contract) or an { items } envelope.
function unwrapList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const env = z.object({ items: z.array(z.unknown()) }).safeParse(raw);
  return env.success ? env.data.items : [];
}

// ---------------------------------------------------------------------------
// Tenant side: feedback-api
// ---------------------------------------------------------------------------

export async function createTicket(
  payload: SupportTicketCreateInput,
): Promise<SupportTicket> {
  const raw = await apiRequest<unknown>('/feedback-api/tickets', {
    method: 'POST',
    body: payload,
  });
  return SupportTicketSchema.parse(raw);
}

export async function listMyTickets(
  filters: MyTicketsFilters = {},
): Promise<SupportTicket[]> {
  const raw = await apiRequest<unknown>(
    `/feedback-api/tickets${ticketsQs(filters)}`,
    { method: 'GET' },
  );
  return z.array(SupportTicketSchema).parse(unwrapList(raw));
}

export async function getTicket(id: string): Promise<SupportTicket> {
  const raw = await apiRequest<unknown>(`/feedback-api/tickets/${id}`, {
    method: 'GET',
  });
  return SupportTicketSchema.parse(raw);
}

export async function listTicketComments(
  id: string,
): Promise<SupportTicketComment[]> {
  const raw = await apiRequest<unknown>(
    `/feedback-api/tickets/${id}/comments`,
    { method: 'GET' },
  );
  return z.array(SupportTicketCommentSchema).parse(unwrapList(raw));
}

export async function addTicketComment(
  id: string,
  payload: SupportTicketCommentCreateInput,
): Promise<SupportTicketComment> {
  const raw = await apiRequest<unknown>(
    `/feedback-api/tickets/${id}/comments`,
    { method: 'POST', body: payload },
  );
  return SupportTicketCommentSchema.parse(raw);
}

// ---------------------------------------------------------------------------
// Staff side: feedback-admin-api
// ---------------------------------------------------------------------------

const PlatformStaffSchema = z.object({ platform_staff: z.boolean() });

/**
 * GET /feedback-admin-api/me. Never 403s: returns { platform_staff } so the
 * SPA can decide whether to render the staff inbox nav and page. The server is
 * still the authority on every staff data call.
 */
export async function getPlatformStaff(): Promise<boolean> {
  const raw = await apiRequest<unknown>('/feedback-admin-api/me', {
    method: 'GET',
  });
  return PlatformStaffSchema.parse(raw).platform_staff;
}

export async function listStaffTickets(
  filters: StaffTicketsFilters = {},
): Promise<SupportTicketStaff[]> {
  const raw = await apiRequest<unknown>(
    `/feedback-admin-api/tickets${ticketsQs(filters)}`,
    { method: 'GET' },
  );
  return z.array(SupportTicketStaffSchema).parse(unwrapList(raw));
}

export async function getStaffTicket(
  id: string,
): Promise<SupportTicketStaff> {
  const raw = await apiRequest<unknown>(`/feedback-admin-api/tickets/${id}`, {
    method: 'GET',
  });
  return SupportTicketStaffSchema.parse(raw);
}

export async function listStaffTicketComments(
  id: string,
): Promise<SupportTicketComment[]> {
  const raw = await apiRequest<unknown>(
    `/feedback-admin-api/tickets/${id}/comments`,
    { method: 'GET' },
  );
  return z.array(SupportTicketCommentSchema).parse(unwrapList(raw));
}

export async function updateStaffTicket(
  id: string,
  payload: SupportTicketStaffUpdateInput,
): Promise<SupportTicketStaff> {
  const raw = await apiRequest<unknown>(`/feedback-admin-api/tickets/${id}`, {
    method: 'PATCH',
    body: payload,
  });
  return SupportTicketStaffSchema.parse(raw);
}

export async function addStaffTicketComment(
  id: string,
  payload: SupportTicketStaffCommentCreateInput,
): Promise<SupportTicketComment> {
  const raw = await apiRequest<unknown>(
    `/feedback-admin-api/tickets/${id}/comments`,
    { method: 'POST', body: payload },
  );
  return SupportTicketCommentSchema.parse(raw);
}
