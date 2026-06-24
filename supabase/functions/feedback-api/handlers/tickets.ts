// feedback-api ticket handlers (tenant side).
//   GET    /tickets
//   POST   /tickets
//   GET    /tickets/:id
//   GET    /tickets/:id/comments
//   POST   /tickets/:id/comments
//
// RLS posture: service-role admin() client, every query carries an explicit
// `.eq('org_id', caller.orgId)` (Pattern A). The capability check is the
// per-route authority. Every non-GET handler runs under respondWithIdempotency.
//
// Notifications: a new ticket and a new tenant reply queue a best-effort email
// to each platform_staff operator. A notification failure never fails the
// caller's request (logged and continued).

import type { RouteCtx } from '../../_shared/route.ts';
import { ApiError, ok } from '../../_shared/responses.ts';
import {
  admin,
  created,
  parseBody,
  parseUuidParam,
  requireCap,
  respondWithIdempotency,
} from '../../_shared/handler-helpers.ts';
import { requireCaller, type Caller } from '../../_shared/tenant.ts';
import {
  SupportTicketCommentCreateSchema,
  SupportTicketCommentSchema,
  SupportTicketCreateSchema,
  SupportTicketSchema,
  type SupportTicket,
  type SupportTicketComment,
} from '../../_shared/types/feedback.ts';
import { BUNDLE } from '../_helpers.ts';
import { notifyStaffNewReply, notifyStaffNewTicket } from '../notifications.ts';

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

function rowToTicket(row: TicketRow): SupportTicket {
  return SupportTicketSchema.parse(row);
}

function rowToComment(row: CommentRow): SupportTicketComment {
  return SupportTicketCommentSchema.parse(row);
}

// Resolve a ticket inside the caller's org. 404 when missing or cross-tenant
// (RLS Pattern A: the org filter turns a foreign id into "not found").
async function fetchTicketRow(caller: Caller, id: string): Promise<TicketRow> {
  const { data, error } = await admin()
    .from('support_tickets')
    .select(TICKET_COLS)
    .eq('id', id)
    .eq('org_id', caller.orgId)
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

export async function listTickets({ req, url }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  // A read is fine for anyone in the org; gate on a cap the tenant roles carry.
  requireCap(caller, 'support.ticket.create');

  const status = url.searchParams.get('status');
  const type = url.searchParams.get('type');

  let query = admin()
    .from('support_tickets')
    .select(TICKET_COLS)
    .eq('org_id', caller.orgId)
    .is('deleted_at', null);

  if (status) query = query.eq('status', status);
  if (type) query = query.eq('type', type);

  query = query.order('created_at', { ascending: false });

  const { data, error } = await query;
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 500, 'support ticket list failed', {
      detail: error.message,
    });
  }
  const rows = (data ?? []) as unknown as TicketRow[];
  return ok(rows.map(rowToTicket));
}

export async function getTicket({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'support.ticket.create');
  const id = parseUuidParam(params.id!);
  const row = await fetchTicketRow(caller, id);
  return ok(rowToTicket(row));
}

export async function createTicket(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'support.ticket.create');
  const body = await parseBody(ctx.req, SupportTicketCreateSchema);

  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    `${ctx.req.method} /tickets`,
    body,
    async () => {
      // Per-org human reference from the numbering chassis (FB-2026-00001).
      // next_doc_number(org_id uuid, doc_type text); the 'feedback' doc_type
      // was registered on the chassis in migration 0141. Called via rpc() with
      // named params rather than the _shared/numbering.ts helper because that
      // helper's DocType union does not include 'feedback' and _shared/ is
      // out of scope for this change.
      const refRes = await admin().rpc('next_doc_number', {
        p_org_id: caller.orgId,
        p_doc_type: 'feedback',
      });
      if (refRes.error) {
        throw new ApiError(
          'INTERNAL_ERROR',
          500,
          'support ticket reference allocation failed',
          { detail: refRes.error.message },
        );
      }
      const reference =
        typeof refRes.data === 'string' && refRes.data.length > 0
          ? refRes.data
          : null;

      const insert = {
        org_id: caller.orgId,
        created_by: caller.userId,
        reference,
        type: body.type,
        title: body.title,
        body: body.body,
        status: 'open',
        context: body.context ?? {},
      };
      const { data, error } = await admin()
        .from('support_tickets')
        .insert(insert)
        .select(TICKET_COLS)
        .single();
      if (error) {
        throw new ApiError('INTERNAL_ERROR', 500, 'support ticket insert failed', {
          detail: error.message,
        });
      }
      const ticket = data as unknown as TicketRow;

      // Best-effort: ping platform staff. Never fails the create.
      await notifyStaffNewTicket(ticket);

      return created(rowToTicket(ticket));
    },
  );
}

export async function listTicketComments(
  { req, params }: RouteCtx,
): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'support.ticket.create');
  const id = parseUuidParam(params.id!);
  // Verify the ticket lives in the caller's org first (404 otherwise).
  await fetchTicketRow(caller, id);

  const { data, error } = await admin()
    .from('support_ticket_comments')
    .select(COMMENT_COLS)
    .eq('ticket_id', id)
    .eq('org_id', caller.orgId)
    .eq('is_internal', false)
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

export async function createTicketComment(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'support.ticket.comment');
  const id = parseUuidParam(ctx.params.id!);
  const body = await parseBody(ctx.req, SupportTicketCommentCreateSchema);

  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    `${ctx.req.method} /tickets/:id/comments`,
    body,
    async () => {
      // Ticket must exist in the caller's org (404 otherwise).
      const ticket = await fetchTicketRow(caller, id);

      const insert = {
        ticket_id: id,
        org_id: caller.orgId,
        author_id: caller.userId,
        author_kind: 'tenant_user',
        is_internal: false,
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

      // Best-effort: ping platform staff about the new tenant reply.
      await notifyStaffNewReply(ticket);

      return created(rowToComment(comment));
    },
  );
}
