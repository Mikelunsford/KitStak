// feedback-admin-api ticket handlers (platform-staff, CROSS-TENANT).
//   GET    /me                     (staff boolean; does NOT 403)
//   GET    /tickets                (cross-org list)
//   GET    /tickets/:id            (one ticket, any org)
//   GET    /tickets/:id/comments   (ALL comments, including is_internal)
//   PATCH  /tickets/:id            (status / priority)
//   POST   /tickets/:id/comments   (staff reply or internal note)
//
// RLS posture: these handlers read and write ACROSS orgs. They use the
// service-role admin() client with NO org filter. That is the deliberate,
// gated cross-tenant path: every handler runs assertPlatformStaff(caller)
// first (the server authority), and platform_staff is the operator allowlist.
// Every non-GET handler runs under respondWithIdempotency.

import type { RouteCtx } from '../../_shared/route.ts';
import { ApiError, ok } from '../../_shared/responses.ts';
import {
  admin,
  created,
  parseBody,
  parseLimit,
  parseUuidParam,
  respondWithIdempotency,
} from '../../_shared/handler-helpers.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import {
  SupportTicketCommentSchema,
  SupportTicketStaffCommentCreateSchema,
  SupportTicketStaffSchema,
  SupportTicketStaffUpdateSchema,
  type SupportTicketComment,
  type SupportTicketStaff,
} from '../../_shared/types/feedback.ts';
import {
  assertPlatformStaff,
  BUNDLE,
  isPlatformStaff,
} from '../_helpers.ts';
import {
  notifyTesterStaffReply,
  notifyTesterStatusChange,
} from '../notifications.ts';

const TICKET_COLS =
  'id, org_id, reference, type, title, body, status, priority, context, ' +
  'resolved_at, closed_at, created_at, created_by, updated_at';

const COMMENT_COLS =
  'id, ticket_id, org_id, author_id, author_kind, body, is_internal, created_at';

interface TicketRow {
  id: string;
  org_id: string;
  reference: string | null;
  type: string;
  title: string;
  body: string;
  status: string;
  priority: string | null;
  context: Record<string, unknown>;
  resolved_at: string | null;
  closed_at: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
}

interface CommentRow {
  id: string;
  ticket_id: string;
  org_id: string;
  author_id: string | null;
  author_kind: string;
  body: string;
  is_internal: boolean;
  created_at: string;
}

function rowToComment(row: CommentRow): SupportTicketComment {
  return SupportTicketCommentSchema.parse(row);
}

// Resolve a ticket in ANY org (cross-tenant). 404 only when the id does not
// exist at all. No org filter: the platform-staff gate is the authority.
async function fetchTicketAnyOrg(id: string): Promise<TicketRow> {
  const { data, error } = await admin()
    .from('support_tickets')
    .select(TICKET_COLS)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 500, 'support ticket lookup failed', {
      detail: error.message,
    });
  }
  if (!data) throw new ApiError('NOT_FOUND', 404, 'support ticket not found');
  return data as unknown as TicketRow;
}

// Resolve org_id -> org name for a set of org ids (one query).
async function resolveOrgNames(
  orgIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (orgIds.length === 0) return map;
  // organizations carries the tenant name in display_name (0001); there is no
  // bare `name` column. Map display_name onto the canon's org_name field.
  const { data, error } = await admin()
    .from('organizations')
    .select('id, display_name')
    .in('id', orgIds);
  if (error || !data) return map;
  for (const row of data as Array<{ id: string; display_name: string | null }>) {
    if (row.display_name) map.set(row.id, row.display_name);
  }
  return map;
}

// Resolve user_id -> email for a set of user ids via the admin auth API.
// auth.users has no FK-style join from PostgREST, so we map per distinct id.
async function resolveEmails(
  userIds: Array<string | null>,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const distinct = new Set<string>();
  for (const id of userIds) {
    if (id) distinct.add(id);
  }
  const sb = admin();
  for (const id of distinct) {
    try {
      const res = await sb.auth.admin.getUserById(id);
      const email = res.data?.user?.email ?? null;
      if (email) map.set(id, email);
    } catch {
      // best-effort; leave unresolved
    }
  }
  return map;
}

// Count non-deleted comments per ticket for a set of ticket ids (one query).
async function resolveCommentCounts(
  ticketIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (ticketIds.length === 0) return map;
  const { data, error } = await admin()
    .from('support_ticket_comments')
    .select('ticket_id')
    .in('ticket_id', ticketIds)
    .is('deleted_at', null);
  if (error || !data) return map;
  for (const row of data as Array<{ ticket_id: string }>) {
    map.set(row.ticket_id, (map.get(row.ticket_id) ?? 0) + 1);
  }
  return map;
}

function toStaffRow(
  row: TicketRow,
  orgNames: Map<string, string>,
  emails: Map<string, string>,
  counts: Map<string, number>,
): SupportTicketStaff {
  return SupportTicketStaffSchema.parse({
    ...row,
    org_name: orgNames.get(row.org_id) ?? null,
    created_by_email: row.created_by
      ? emails.get(row.created_by) ?? null
      : null,
    comment_count: counts.get(row.id) ?? 0,
  });
}

export async function getMe({ req }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  // Reports the boolean; does NOT 403 for non-staff (the SPA uses it to decide
  // whether to surface the staff nav).
  const staff = await isPlatformStaff(caller.userId);
  return ok({ platform_staff: staff });
}

export async function listTickets({ req, url }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  await assertPlatformStaff(caller);

  const limit = parseLimit(url);
  const status = url.searchParams.get('status');
  const type = url.searchParams.get('type');
  const orgId = url.searchParams.get('org_id');

  let query = admin()
    .from('support_tickets')
    .select(TICKET_COLS)
    .is('deleted_at', null);

  if (status) query = query.eq('status', status);
  if (type) query = query.eq('type', type);
  if (orgId) query = query.eq('org_id', orgId);

  query = query.order('created_at', { ascending: false }).limit(limit);

  const { data, error } = await query;
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 500, 'support ticket list failed', {
      detail: error.message,
    });
  }
  const rows = (data ?? []) as unknown as TicketRow[];

  const orgNames = await resolveOrgNames([...new Set(rows.map((r) => r.org_id))]);
  const emails = await resolveEmails(rows.map((r) => r.created_by));
  const counts = await resolveCommentCounts(rows.map((r) => r.id));

  return ok(rows.map((r) => toStaffRow(r, orgNames, emails, counts)));
}

export async function getTicket({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  await assertPlatformStaff(caller);
  const id = parseUuidParam(params.id!);
  const row = await fetchTicketAnyOrg(id);

  const orgNames = await resolveOrgNames([row.org_id]);
  const emails = await resolveEmails([row.created_by]);
  const counts = await resolveCommentCounts([row.id]);

  return ok(toStaffRow(row, orgNames, emails, counts));
}

export async function listTicketComments(
  { req, params }: RouteCtx,
): Promise<Response> {
  const caller = requireCaller(req);
  await assertPlatformStaff(caller);
  const id = parseUuidParam(params.id!);
  // Confirm the ticket exists (404 otherwise).
  await fetchTicketAnyOrg(id);

  const { data, error } = await admin()
    .from('support_ticket_comments')
    .select(COMMENT_COLS)
    .eq('ticket_id', id)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 500, 'support comment list failed', {
      detail: error.message,
    });
  }
  const rows = (data ?? []) as unknown as CommentRow[];
  return ok(rows.map(rowToComment));
}

export async function patchTicket(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  await assertPlatformStaff(caller);
  const id = parseUuidParam(ctx.params.id!);
  const body = await parseBody(ctx.req, SupportTicketStaffUpdateSchema);

  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    `${ctx.req.method} /tickets/:id`,
    body,
    async () => {
      const current = await fetchTicketAnyOrg(id);

      const nowIso = new Date().toISOString();
      const patch: Record<string, unknown> = {
        updated_by: caller.userId,
        updated_at: nowIso,
      };
      if (body.status !== undefined) {
        patch.status = body.status;
        // Stamp resolved_at / closed_at only on the transition into that state.
        if (body.status === 'resolved' && current.status !== 'resolved') {
          patch.resolved_at = nowIso;
        }
        if (body.status === 'closed' && current.status !== 'closed') {
          patch.closed_at = nowIso;
        }
      }
      if (body.priority !== undefined) {
        patch.priority = body.priority;
      }

      const { data, error } = await admin()
        .from('support_tickets')
        .update(patch)
        .eq('id', id)
        .select(TICKET_COLS)
        .single();
      if (error) {
        throw new ApiError('INTERNAL_ERROR', 500, 'support ticket update failed', {
          detail: error.message,
        });
      }
      const updated = data as unknown as TicketRow;

      // Notify the submitter on a status change (in-app + email, best-effort).
      if (body.status !== undefined && body.status !== current.status) {
        await notifyTesterStatusChange(updated, body.status);
      }

      const orgNames = await resolveOrgNames([updated.org_id]);
      const emails = await resolveEmails([updated.created_by]);
      const counts = await resolveCommentCounts([updated.id]);
      return ok(toStaffRow(updated, orgNames, emails, counts));
    },
  );
}

export async function createTicketComment(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  await assertPlatformStaff(caller);
  const id = parseUuidParam(ctx.params.id!);
  const body = await parseBody(ctx.req, SupportTicketStaffCommentCreateSchema);

  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    `${ctx.req.method} /tickets/:id/comments`,
    body,
    async () => {
      // Look up the ticket to inherit its org_id (cross-tenant insert target).
      const ticket = await fetchTicketAnyOrg(id);
      const isInternal = body.is_internal ?? false;

      const insert = {
        ticket_id: id,
        org_id: ticket.org_id,
        author_id: caller.userId,
        author_kind: 'platform_staff',
        is_internal: isInternal,
        body: body.body,
      };
      const { data, error } = await admin()
        .from('support_ticket_comments')
        .insert(insert)
        .select(COMMENT_COLS)
        .single();
      if (error) {
        throw new ApiError('INTERNAL_ERROR', 500, 'support comment insert failed', {
          detail: error.message,
        });
      }
      const comment = data as unknown as CommentRow;

      // A public (non-internal) reply notifies the submitter. Internal notes
      // stay on the staff surface and never ping the tenant.
      if (!isInternal) {
        await notifyTesterStaffReply(ticket);
      }

      return created(rowToComment(comment));
    },
  );
}
