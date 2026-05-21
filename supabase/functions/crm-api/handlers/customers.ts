// crm-api customers handlers.
//   GET    /customers
//   POST   /customers
//   GET    /customers/:id
//   PATCH  /customers/:id
//   DELETE /customers/:id   (soft delete; sets deleted_at)
//
// RLS pattern A scopes by `org_id = current_org_id()` plus staff-role check
// from migration 0007. Handlers also call `.eq('org_id', caller.orgId)` for
// defense in depth.

import { z } from 'zod';

import type { RouteCtx } from '../../_shared/route.ts';
import { ApiError, ok, created, noContent } from '../../_shared/responses.ts';
import {
  admin,
  decodeCursor,
  paginate,
  parseBody,
  parseLimit,
  parseUuidParam,
  respondWithIdempotency,
} from '../../_shared/handler-helpers.ts';
import { requireCaller, type Caller } from '../../_shared/tenant.ts';
import {
  CustomerCreateSchema,
  CustomerPatchSchema,
  CustomerSchema,
  type Customer,
} from '../../_shared/types/crm.ts';
import { BUNDLE } from '../_helpers.ts';
import { requireCap } from '../../_shared/handler-helpers.ts';

const CUSTOMER_COLS =
  'id, org_id, display_name, kind, status, primary_email, primary_phone, ' +
  'tax_id, billing_address, shipping_address, default_currency_code, ' +
  'default_payment_terms_days, tags, created_at, updated_at';

interface CustomerRow {
  id: string;
  org_id: string;
  display_name: string;
  kind: string;
  status: string;
  primary_email: string | null;
  primary_phone: string | null;
  tax_id: string | null;
  billing_address: Record<string, unknown> | null;
  shipping_address: Record<string, unknown> | null;
  default_currency_code: string | null;
  default_payment_terms_days: number | null;
  tags: string[] | null;
  created_at: string;
  updated_at: string;
}

function rowToCustomer(row: CustomerRow): Customer {
  return CustomerSchema.parse({
    id: row.id,
    org_id: row.org_id,
    display_name: row.display_name,
    kind: row.kind,
    status: row.status,
    primary_email: row.primary_email,
    primary_phone: row.primary_phone,
    tax_id: row.tax_id,
    billing_address: row.billing_address,
    shipping_address: row.shipping_address,
    default_currency_code: row.default_currency_code,
    default_payment_terms_days: row.default_payment_terms_days,
    tags: row.tags ?? [],
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}

async function fetchCustomerRow(
  caller: Caller,
  id: string,
): Promise<CustomerRow> {
  const { data, error } = await admin()
    .from('customers')
    .select(CUSTOMER_COLS)
    .eq('id', id)
    .eq('org_id', caller.orgId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 500, 'customer lookup failed', {
      detail: error.message,
    });
  }
  if (!data) throw new ApiError('NOT_FOUND', 404, 'customer not found');
  return data as CustomerRow;
}

export async function listCustomers({ req, url }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'crm.customers.read');

  const limit = parseLimit(url);
  const cursor = decodeCursor(url.searchParams.get('cursor'));
  const q = url.searchParams.get('q');
  const status = url.searchParams.get('status');
  const kind = url.searchParams.get('kind');

  let query = admin()
    .from('customers')
    .select(CUSTOMER_COLS)
    .eq('org_id', caller.orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);

  if (status) query = query.eq('status', status);
  if (kind) query = query.eq('kind', kind);
  if (q) query = query.ilike('display_name', `%${q}%`);
  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await query;
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 500, 'customer list failed', {
      detail: error.message,
    });
  }
  const rows = (data ?? []) as CustomerRow[];
  const { items, next_cursor } = paginate(rows, limit);
  return ok(items.map(rowToCustomer), { next_cursor });
}

export async function getCustomer({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'crm.customers.read');
  parseUuidParam(params.id);
  const row = await fetchCustomerRow(caller, params.id);
  return ok(rowToCustomer(row));
}

export async function createCustomer({ req }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'crm.customers.write');
  const body = await parseBody(req, CustomerCreateSchema);

  return respondWithIdempotency(req, caller, BUNDLE, 'POST /customers', body, async () => {
    const insertRow = {
      org_id: caller.orgId,
      display_name: body.display_name,
      kind: body.kind,
      status: 'new',
      primary_email: body.primary_email ?? null,
      primary_phone: body.primary_phone ?? null,
      tax_id: body.tax_id ?? null,
      billing_address: body.billing_address ?? null,
      shipping_address: body.shipping_address ?? null,
      default_currency_code: body.default_currency_code ?? null,
      default_payment_terms_days: body.default_payment_terms_days ?? null,
      tags: body.tags ?? [],
      created_by: caller.userId,
      updated_by: caller.userId,
    };
    const { data, error } = await admin()
      .from('customers')
      .insert(insertRow)
      .select(CUSTOMER_COLS)
      .single();
    if (error || !data) {
      throw new ApiError('INTERNAL_ERROR', 500, 'customer insert failed', {
        detail: error?.message,
      });
    }
    return created(rowToCustomer(data as CustomerRow));
  });
}

export async function patchCustomer({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'crm.customers.write');
  parseUuidParam(params.id);
  const body = await parseBody(req, CustomerPatchSchema);

  return respondWithIdempotency(
    req,
    caller,
    BUNDLE,
    'PATCH /customers/:id',
    body,
    async () => {
      await fetchCustomerRow(caller, params.id);

      const patch: Record<string, unknown> = { updated_by: caller.userId };
      if (body.display_name !== undefined) patch.display_name = body.display_name;
      if (body.kind !== undefined) patch.kind = body.kind;
      if (body.primary_email !== undefined) patch.primary_email = body.primary_email;
      if (body.primary_phone !== undefined) patch.primary_phone = body.primary_phone;
      if (body.tax_id !== undefined) patch.tax_id = body.tax_id;
      if (body.billing_address !== undefined) patch.billing_address = body.billing_address ?? null;
      if (body.shipping_address !== undefined) patch.shipping_address = body.shipping_address ?? null;
      if (body.default_currency_code !== undefined) {
        patch.default_currency_code = body.default_currency_code;
      }
      if (body.default_payment_terms_days !== undefined) {
        patch.default_payment_terms_days = body.default_payment_terms_days ?? null;
      }
      if (body.tags !== undefined) patch.tags = body.tags ?? [];

      const { data, error } = await admin()
        .from('customers')
        .update(patch)
        .eq('id', params.id)
        .eq('org_id', caller.orgId)
        .select(CUSTOMER_COLS)
        .single();
      if (error || !data) {
        throw new ApiError('INTERNAL_ERROR', 500, 'customer update failed', {
          detail: error?.message,
        });
      }
      return ok(rowToCustomer(data as CustomerRow));
    },
  );
}

export async function deleteCustomer({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'crm.customers.delete');
  parseUuidParam(params.id);

  return respondWithIdempotency(
    req,
    caller,
    BUNDLE,
    'DELETE /customers/:id',
    { id: params.id },
    async () => {
      await fetchCustomerRow(caller, params.id);
      const { error } = await admin()
        .from('customers')
        .update({ deleted_at: new Date().toISOString(), updated_by: caller.userId })
        .eq('id', params.id)
        .eq('org_id', caller.orgId);
      if (error) {
        throw new ApiError('INTERNAL_ERROR', 500, 'customer delete failed', {
          detail: error.message,
        });
      }
      return noContent();
    },
  );
}

// POST /customers/:id/invite-to-portal
//
// Path B2 customer portal invitation, MAGICLINK-01 revision. Calls
// supabase.auth.admin.generateLink({ type: 'magiclink' }) to produce a
// single-use sign-in URL (creates auth.users on demand for first-time
// recipients; reuses the existing row otherwise). The returned action_link
// is embedded in a Kitstak-branded email queued through the existing
// notifications table, which the 5-minute drain cron ships via the Resend
// transport proven end-to-end in Path B1. Click flow: customer opens email,
// clicks the link, Supabase exchanges the token for a session, browser
// lands signed-in at https://www.kitstak.com/portal — no password ever
// required.
//
// After the link generates, calls the create_portal_membership RPC from
// migration 0055 to atomically insert the org_memberships row with
// role=customer_user + customer_id mapping.
//
// Recipient resolution: body.email_override > customer.primary_email > 422.
// Capability: crm.customers.invite_to_portal (granted to org_owner, org_admin,
// sales, accounting; NOT to ops, viewer, customer_user, vendor_user).
//
// Idempotency: the surrounding respondWithIdempotency wrapper deduplicates
// repeat clicks of the same Invite button (same key + same body). At the DB
// layer, create_portal_membership uses ON CONFLICT (org_id, user_id) DO UPDATE
// so even a fresh-key re-invite of the same user is safe. generateLink itself
// is safe to re-call: each call returns a fresh single-use token, the
// previous one becomes invalid.
const InviteToPortalBodySchema = z.object({
  email_override: z.string().email().optional(),
});

const PORTAL_REDIRECT_URL = 'https://www.kitstak.com/portal';

export async function inviteCustomerToPortal({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'crm.customers.invite_to_portal');
  parseUuidParam(params.id);
  const body = await parseBody(req, InviteToPortalBodySchema);

  return respondWithIdempotency(
    req,
    caller,
    BUNDLE,
    'POST /customers/:id/invite-to-portal',
    { id: params.id, ...body },
    async () => {
      const customer = await fetchCustomerRow(caller, params.id);
      const email = body.email_override ?? customer.primary_email;
      if (!email) {
        throw new ApiError(
          'VALIDATION_ERROR',
          422,
          'Customer has no primary_email and no email_override was provided. Add an email to the customer record or pass email_override on the request.',
        );
      }

      const client = admin();
      const linkResult = await client.auth.admin.generateLink({
        type: 'magiclink',
        email,
        options: { redirectTo: PORTAL_REDIRECT_URL },
      });
      if (linkResult.error) {
        throw new ApiError(
          'VALIDATION_ERROR',
          422,
          `Auth magic-link generation failed: ${linkResult.error.message}`,
          { detail: linkResult.error.message },
        );
      }
      const userId = linkResult.data.user?.id;
      const actionLink = linkResult.data.properties?.action_link;
      if (!userId || !actionLink) {
        throw new ApiError(
          'INTERNAL_ERROR',
          500,
          'Auth magic-link generation returned no user id or action_link',
        );
      }

      const { data: membershipId, error: rpcError } = await client.rpc(
        'create_portal_membership',
        {
          p_customer_id: customer.id,
          p_user_id: userId,
          p_org_id: caller.orgId,
        },
      );
      if (rpcError) {
        throw new ApiError(
          'INTERNAL_ERROR',
          500,
          `Portal membership creation failed: ${rpcError.message}`,
          { detail: rpcError.message },
        );
      }

      // Queue the branded magic-link email through the existing notifications
      // chassis. The 5-minute drain cron picks this up and ships via Resend
      // (same path that delivered the 7 Path B1 smoke emails). Failure to
      // queue is logged but does not unwind the membership: the staff caller
      // can re-click Invite to retry queuing, and the membership row is
      // idempotent.
      const subject = `Sign in to your ${customer.display_name} portal`;
      const emailBody =
        `Hi ${customer.display_name},\n\n` +
        `You have been invited to your customer portal at Kitstak. ` +
        `Click the link below to sign in. No password required.\n\n` +
        `${actionLink}\n\n` +
        `This link signs you in directly. If you did not expect this email, ` +
        `you can ignore it.\n\n` +
        `Thanks.`;
      const { error: notifErr } = await client.from('notifications').insert({
        org_id: caller.orgId,
        recipient_user_id: userId,
        entity_type: 'customer',
        entity_id: customer.id,
        channel: 'email',
        subject,
        body: emailBody,
        payload: { to: email, kind: 'portal_invite' },
        created_by: caller.userId,
        updated_by: caller.userId,
      });
      if (notifErr) {
        console.error('crm-api: failed to queue portal-invite email', {
          customer_id: customer.id,
          org_id: caller.orgId,
          message: notifErr.message,
        });
      }

      return ok({
        membership_id: membershipId,
        user_id: userId,
        email,
        customer_id: customer.id,
      });
    },
  );
}
