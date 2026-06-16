// invoicing-api credit_notes handlers.
//   GET    /credit-notes
//   POST   /credit-notes
//   GET    /credit-notes/:id
//   PATCH  /credit-notes/:id
//   DELETE /credit-notes/:id
//   POST   /credit-notes/:id/apply
//   POST   /credit-notes/:id/issue   (draft -> issued)
//   POST   /credit-notes/:id/void    (draft|issued -> voided)
//
// Pattern A on credit_notes. Allocations write via /apply, the
// recompute trigger keeps applied_cents and invoices.credit_allocated_cents
// synced. Each allocation row produces an auto-JE via 0024.
//
// Lifecycle transitions (issue / void) enforce creditNoteStateMachine via
// canFinanceTransition (409 STATE_CONFLICT on an illegal move) and stamp the
// matching timestamp column (issued_at / voided_at). The AFTER UPDATE status
// audit trigger writes the audit_log row; handlers never hand-write audit
// rows. Mirrors the invoice send / cancel / transition shape in invoices.ts.

import { z } from 'zod';

import type { RouteCtx } from '../../_shared/route.ts';
import { ApiError, ok, noContent } from '../../_shared/responses.ts';
import {
  admin,
  created,
  decodeCursor,
  paginate,
  parseBody,
  parseLimit,
  parseUuidParam,
  respondWithIdempotency,
} from '../../_shared/handler-helpers.ts';
import { requireCaller, type Caller } from '../../_shared/tenant.ts';
import { assertRefInOrg } from '../../_shared/crud.ts';
import {
  CreditNoteSchema,
  CreditNoteAllocationSchema,
  type CreditNote,
  type CreditNoteAllocation,
} from '../../_shared/types/finance.ts';
import {
  creditNoteStateMachine,
  canFinanceTransition,
  type CreditNoteState,
} from '../../_shared/workflow/finance.ts';
import { BUNDLE } from '../_helpers.ts';
import { requireCap } from '../../_shared/handler-helpers.ts';

const CN_COLS =
  'id, org_id, credit_note_number, customer_id, source_invoice_id, status, ' +
  'state_changed_at, currency_code, amount_cents, applied_cents, reason, ' +
  'issued_at, voided_at, created_at, updated_at';

const ALLOC_COLS = 'id, credit_note_id, invoice_id, amount_cents, created_at';

const CreditNoteCreateSchema = z.object({
  credit_note_number: z.string().min(1),
  customer_id: z.string().uuid().optional(),
  source_invoice_id: z.string().uuid().optional(),
  currency_code: z.string().min(3).max(3).default('USD'),
  amount_cents: z.union([z.number().int(), z.string().regex(/^-?\d+$/)]),
  reason: z.string().optional(),
});

const CreditNotePatchSchema = CreditNoteCreateSchema.partial();

const CreditNoteApplySchema = z.object({
  allocations: z
    .array(
      z.object({
        invoice_id: z.string().uuid(),
        amount_cents: z.union([z.number().int(), z.string().regex(/^-?\d+$/)]),
      }),
    )
    .min(1),
});

function rowToCN(row: unknown): CreditNote {
  return CreditNoteSchema.parse(row);
}

function rowToCnAlloc(row: unknown): CreditNoteAllocation {
  return CreditNoteAllocationSchema.parse(row);
}

async function fetchCN(orgId: string, id: string) {
  const { data, error } = await admin()
    .from('credit_notes')
    .select(CN_COLS)
    .eq('id', id)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 500, 'credit note lookup failed', {
      detail: error.message,
    });
  }
  if (!data) throw new ApiError('NOT_FOUND', 404, 'credit note not found');
  return data;
}

export async function listCreditNotes({ req, url }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'credit_notes.read');

  const limit = parseLimit(url);
  const cursor = decodeCursor(url.searchParams.get('cursor'));
  const status = url.searchParams.get('status');
  // F-Wave7-LISTFILTER-01: customer_id FK filter mirrors invoices/payments
  // parity. RLS Pattern A wraps the org gate so a cross-tenant customer_id
  // still resolves to 200 + [].
  const customerId = url.searchParams.get('customer_id');

  let query = admin()
    .from('credit_notes')
    .select(CN_COLS)
    .eq('org_id', caller.orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);

  if (status) query = query.eq('status', status);
  if (customerId) query = query.eq('customer_id', customerId);
  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    );
  }
  const { data, error } = await query;
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 500, 'credit note list failed', {
      detail: error.message,
    });
  }
  const rows = (data ?? []) as unknown as Array<{ id: string; created_at: string }>;
  const { items, next_cursor } = paginate(rows, limit);
  return ok(items.map(rowToCN), next_cursor ? { next_cursor } : undefined);
}

export async function getCreditNote({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'credit_notes.read');
  const id = parseUuidParam(params.id!);
  return ok(rowToCN(await fetchCN(caller.orgId, id)));
}

export async function createCreditNote(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'credit_notes.write');
  const body = await parseBody(ctx.req, CreditNoteCreateSchema);
  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    `${ctx.req.method} /credit-notes`,
    body,
    async () => {
      if (body.customer_id) {
        await assertRefInOrg('customers', caller, body.customer_id);
      }
      if (body.source_invoice_id) {
        await assertRefInOrg('invoices', caller, body.source_invoice_id);
      }
      const insert = {
        org_id: caller.orgId,
        credit_note_number: body.credit_note_number,
        customer_id: body.customer_id ?? null,
        source_invoice_id: body.source_invoice_id ?? null,
        currency_code: body.currency_code,
        amount_cents: body.amount_cents,
        reason: body.reason ?? null,
        status: 'draft',
        created_by: caller.userId,
        updated_by: caller.userId,
      };
      const { data, error } = await admin()
        .from('credit_notes')
        .insert(insert)
        .select(CN_COLS)
        .single();
      if (error) {
        throw new ApiError('INTERNAL_ERROR', 500, 'credit note insert failed', {
          detail: error.message,
        });
      }
      return created(rowToCN(data));
    },
  );
}

export async function patchCreditNote(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'credit_notes.write');
  const id = parseUuidParam(ctx.params.id!);
  const body = await parseBody(ctx.req, CreditNotePatchSchema);
  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    `${ctx.req.method} /credit-notes/:id`,
    body,
    async () => {
      await fetchCN(caller.orgId, id);
      if (body.customer_id) {
        await assertRefInOrg('customers', caller, body.customer_id);
      }
      if (body.source_invoice_id) {
        await assertRefInOrg('invoices', caller, body.source_invoice_id);
      }
      const patch: Record<string, unknown> = { updated_by: caller.userId };
      for (const [k, v] of Object.entries(body)) {
        if (v !== undefined) patch[k] = v;
      }
      const { data, error } = await admin()
        .from('credit_notes')
        .update(patch)
        .eq('id', id)
        .eq('org_id', caller.orgId)
        .select(CN_COLS)
        .single();
      if (error) {
        throw new ApiError('INTERNAL_ERROR', 500, 'credit note update failed', {
          detail: error.message,
        });
      }
      return ok(rowToCN(data));
    },
  );
}

export async function deleteCreditNote(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'credit_notes.delete');
  const id = parseUuidParam(ctx.params.id!);
  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    `${ctx.req.method} /credit-notes/:id`,
    null,
    async () => {
      await fetchCN(caller.orgId, id);
      const { error } = await admin()
        .from('credit_notes')
        .update({ deleted_at: new Date().toISOString(), updated_by: caller.userId })
        .eq('id', id)
        .eq('org_id', caller.orgId);
      if (error) {
        throw new ApiError('INTERNAL_ERROR', 500, 'credit note delete failed', {
          detail: error.message,
        });
      }
      return noContent();
    },
  );
}

export async function applyCreditNote(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'credit_notes.apply');
  const id = parseUuidParam(ctx.params.id!);
  const body = await parseBody(ctx.req, CreditNoteApplySchema);

  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    `${ctx.req.method} /credit-notes/:id/apply`,
    body,
    async () => {
      await fetchCN(caller.orgId, id);
      for (const a of body.allocations) {
        await assertRefInOrg('invoices', caller, a.invoice_id);
      }
      const rows = body.allocations.map((a) => ({
        credit_note_id: id,
        invoice_id: a.invoice_id,
        amount_cents: a.amount_cents,
        created_by: caller.userId,
      }));
      const { data, error } = await admin()
        .from('credit_note_allocations')
        .insert(rows)
        .select(ALLOC_COLS);
      if (error) {
        if (error.message && error.message.startsWith('period_closed:')) {
          throw new ApiError('VALIDATION_ERROR', 422, error.message);
        }
        throw new ApiError('INTERNAL_ERROR', 500, 'credit note apply failed', {
          detail: error.message,
        });
      }
      return ok((data ?? []).map(rowToCnAlloc));
    },
  );
}

// Shared lifecycle transition. Loads the credit note (404 if absent /
// cross-tenant), enforces creditNoteStateMachine (409 STATE_CONFLICT on an
// illegal move), patches status, and stamps the matching timestamp column.
// The AFTER UPDATE status audit trigger writes audit_log; we never hand-write
// audit rows. Mirrors transitionInvoiceTo in invoices.ts.
async function transitionCreditNoteTo(
  caller: Caller,
  id: string,
  to: CreditNoteState,
): Promise<CreditNote> {
  const row = await fetchCN(caller.orgId, id);
  const from = (row as unknown as { status: string }).status as CreditNoteState;
  // Issue and Void are explicit forward actions, not idempotent self-loops.
  // canFinanceTransition treats `from === to` as allowed (so the generic FSM
  // predicate stays useful for button-gating), but re-issuing an already
  // issued note or re-voiding a voided note is a STATE_CONFLICT at the
  // lifecycle-endpoint grain. Request-level idempotency is the Idempotency-Key,
  // not an FSM no-op.
  if (from === to || !canFinanceTransition(creditNoteStateMachine, from, to)) {
    throw new ApiError(
      'STATE_CONFLICT',
      409,
      `credit note transition ${from} -> ${to} not allowed`,
    );
  }
  const patch: Record<string, unknown> = {
    status: to,
    updated_by: caller.userId,
  };
  if (to === 'issued') patch.issued_at = new Date().toISOString();
  if (to === 'voided') patch.voided_at = new Date().toISOString();

  // R-W13-FIN-01: status-equals-from guard, mirroring transitionInvoiceTo.
  // The status was read above (fetchCN), so `.eq('status', from)` turns this
  // UPDATE into a compare-and-set: a concurrent transition that already moved
  // the row off `from` matches 0 rows and surfaces as STATE_CONFLICT 409
  // rather than silently double-applying. maybeSingle() makes a 0-row result
  // `data === null` instead of the PGRST116 error that `.single()` raises.
  const { data, error } = await admin()
    .from('credit_notes')
    .update(patch)
    .eq('id', id)
    .eq('org_id', caller.orgId)
    .eq('status', from)
    .select(CN_COLS)
    .maybeSingle();
  if (error) {
    // Map the period-closed trigger SQLSTATE P0001 to 422 per security canon,
    // mirroring the invoice + apply handlers.
    if (error.message && error.message.startsWith('period_closed:')) {
      throw new ApiError('VALIDATION_ERROR', 422, error.message);
    }
    throw new ApiError('INTERNAL_ERROR', 500, 'credit note transition failed', {
      detail: error.message,
    });
  }
  if (!data) {
    // fetchCN already 404s a missing / cross-tenant id, so a 0-row UPDATE can
    // only mean the status moved off `from` between the read and the write.
    throw new ApiError(
      'STATE_CONFLICT',
      409,
      `credit note transition ${from} -> ${to} not allowed`,
    );
  }
  return rowToCN(data);
}

export async function issueCreditNote(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'credit_notes.write');
  const id = parseUuidParam(ctx.params.id!);
  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    `${ctx.req.method} /credit-notes/:id/issue`,
    null,
    async () => ok(await transitionCreditNoteTo(caller, id, 'issued')),
  );
}

export async function voidCreditNote(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireCap(caller, 'credit_notes.write');
  const id = parseUuidParam(ctx.params.id!);
  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    `${ctx.req.method} /credit-notes/:id/void`,
    null,
    async () => ok(await transitionCreditNoteTo(caller, id, 'voided')),
  );
}
