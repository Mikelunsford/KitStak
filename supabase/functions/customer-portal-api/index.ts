// customer-portal-api: customer_user role only. Pattern B RLS posture.
//
// Every handler:
//   1. requireCaller(req) -> caller.userId, caller.orgId, caller.role
//   2. Reject any role other than 'customer_user' -> 404 (do not leak existence).
//   3. Resolve the customer_id from org_memberships where the caller is
//      mapped (column added by an identity-side migration; we tolerate
//      absence by reading the JWT app_metadata.customer_id claim as a
//      fallback so the bundle remains useful before the membership column
//      lands).
//   4. Every query .eq('org_id', caller.orgId) AND .eq('customer_id', customerId).
//
// The bundle returns 404 (NOT_FOUND) when role is not customer_user, per the
// constitution's "404 to hide existence from non-tenants" rule.

import { route, type Route } from '../_shared/route.ts';
import { admin } from '../_shared/handler-helpers.ts';
import { ApiError, ok } from '../_shared/responses.ts';
import { requireCaller, type Caller } from '../_shared/tenant.ts';
import { hasCrossCuttingCap } from '../_shared/capabilities/cross_cutting.ts';

const BUNDLE = 'customer-portal-api';

function gatePortal(caller: Caller): void {
  if (caller.role !== 'customer_user') {
    // Hide the bundle's existence from internal users.
    throw new ApiError('NOT_FOUND', 404);
  }
}

async function resolveCustomerId(caller: Caller): Promise<string> {
  // Prefer the membership mapping (Wave 1 schema reserved
  // org_memberships.customer_id for this purpose).
  const { data, error } = await admin()
    .from('org_memberships')
    .select('customer_id')
    .eq('org_id', caller.orgId)
    .eq('user_id', caller.userId)
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 500, error.message);
  }
  const mapped = (data as { customer_id?: string | null } | null)?.customer_id;
  if (mapped) return mapped;
  // Fallback: JWT claim. Not yet shipped; tolerated to keep the bundle
  // exercise-able. If still null, the caller has no associated customer
  // and the portal should 404 the resource.
  throw new ApiError('NOT_FOUND', 404);
}

// ---------------------------------------------------------------------------
// GET /portal/me  -> { customer_id, org_id, display_name, email }
// ---------------------------------------------------------------------------
const me: Route = {
  method: 'GET',
  path: '/portal/me',
  async handler({ req }) {
    const caller = requireCaller(req);
    gatePortal(caller);
    if (!hasCrossCuttingCap(caller.role, 'portal.customer.read')) {
      throw new ApiError('NOT_FOUND', 404);
    }
    const customerId = await resolveCustomerId(caller);
    const { data, error } = await admin()
      .from('customers')
      .select('id, org_id, display_name, email')
      .eq('org_id', caller.orgId)
      .eq('id', customerId)
      .single();
    if (error || !data) {
      throw new ApiError('NOT_FOUND', 404);
    }
    return ok({
      customer_id: data.id,
      org_id: data.org_id,
      display_name: data.display_name,
      email: data.email ?? null,
    });
  },
};

// ---------------------------------------------------------------------------
// GET /portal/invoices
// ---------------------------------------------------------------------------
const invoices: Route = {
  method: 'GET',
  path: '/portal/invoices',
  async handler({ req }) {
    const caller = requireCaller(req);
    gatePortal(caller);
    if (!hasCrossCuttingCap(caller.role, 'portal.invoice.read')) {
      throw new ApiError('NOT_FOUND', 404);
    }
    const customerId = await resolveCustomerId(caller);
    const { data, error } = await admin()
      .from('invoices')
      .select(
        'id, number, status, issued_at, due_at, total_cents, balance_cents, currency_code',
      )
      .eq('org_id', caller.orgId)
      .eq('customer_id', customerId)
      .order('issued_at', { ascending: false })
      .limit(200);
    if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
    return ok(data ?? []);
  },
};

// ---------------------------------------------------------------------------
// GET /portal/quotes
// ---------------------------------------------------------------------------
const quotes: Route = {
  method: 'GET',
  path: '/portal/quotes',
  async handler({ req }) {
    const caller = requireCaller(req);
    gatePortal(caller);
    if (!hasCrossCuttingCap(caller.role, 'portal.quote.read')) {
      throw new ApiError('NOT_FOUND', 404);
    }
    const customerId = await resolveCustomerId(caller);
    const { data, error } = await admin()
      .from('quotes')
      .select('id, number, status, issued_at, expires_at, total_cents, currency_code')
      .eq('org_id', caller.orgId)
      .eq('customer_id', customerId)
      .order('issued_at', { ascending: false })
      .limit(200);
    if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
    return ok(data ?? []);
  },
};

// ---------------------------------------------------------------------------
// GET /portal/projects
// ---------------------------------------------------------------------------
const projects: Route = {
  method: 'GET',
  path: '/portal/projects',
  async handler({ req }) {
    const caller = requireCaller(req);
    gatePortal(caller);
    if (!hasCrossCuttingCap(caller.role, 'portal.project.read')) {
      throw new ApiError('NOT_FOUND', 404);
    }
    const customerId = await resolveCustomerId(caller);
    const { data, error } = await admin()
      .from('projects')
      .select('id, name, status, started_at, expected_completion_at')
      .eq('org_id', caller.orgId)
      .eq('customer_id', customerId)
      .order('started_at', { ascending: false })
      .limit(200);
    if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
    return ok(data ?? []);
  },
};

// ---------------------------------------------------------------------------
// GET /portal/attachments?entity_type=invoice&entity_id=...
// ---------------------------------------------------------------------------
const attachments: Route = {
  method: 'GET',
  path: '/portal/attachments',
  async handler({ req, url }) {
    const caller = requireCaller(req);
    gatePortal(caller);
    if (!hasCrossCuttingCap(caller.role, 'portal.attachment.read')) {
      throw new ApiError('NOT_FOUND', 404);
    }
    const customerId = await resolveCustomerId(caller);
    const entityType = url.searchParams.get('entity_type');
    const entityId = url.searchParams.get('entity_id');
    if (!entityType || !entityId) {
      throw new ApiError('VALIDATION_ERROR', 422, 'entity_type and entity_id are required');
    }

    // Verify the parent entity is the caller's customer's. We look up the
    // entity by id constrained to customer_id. If the lookup fails, 404.
    if (entityType === 'invoice') {
      const { data, error } = await admin()
        .from('invoices')
        .select('id')
        .eq('org_id', caller.orgId)
        .eq('customer_id', customerId)
        .eq('id', entityId)
        .maybeSingle();
      if (error || !data) throw new ApiError('NOT_FOUND', 404);
    } else if (entityType === 'quote') {
      const { data, error } = await admin()
        .from('quotes')
        .select('id')
        .eq('org_id', caller.orgId)
        .eq('customer_id', customerId)
        .eq('id', entityId)
        .maybeSingle();
      if (error || !data) throw new ApiError('NOT_FOUND', 404);
    } else if (entityType === 'project') {
      const { data, error } = await admin()
        .from('projects')
        .select('id')
        .eq('org_id', caller.orgId)
        .eq('customer_id', customerId)
        .eq('id', entityId)
        .maybeSingle();
      if (error || !data) throw new ApiError('NOT_FOUND', 404);
    } else {
      throw new ApiError('NOT_FOUND', 404);
    }

    const { data, error } = await admin()
      .from('attachments')
      .select('id, file_name, content_type, size_bytes, created_at, storage_path')
      .eq('org_id', caller.orgId)
      .eq('entity_type', entityType)
      .eq('entity_id', entityId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    if (error) throw new ApiError('INTERNAL_ERROR', 500, error.message);
    return ok(data ?? []);
  },
};

const TABLE: Route[] = [me, invoices, quotes, projects, attachments];

Deno.serve((req) => route(req, TABLE, { bundle: BUNDLE }));

export { TABLE };
