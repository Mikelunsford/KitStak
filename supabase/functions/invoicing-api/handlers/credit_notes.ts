// invoicing-api credit_notes handlers.
//   GET    /credit-notes
//   POST   /credit-notes
//   GET    /credit-notes/:id
//   PATCH  /credit-notes/:id
//   DELETE /credit-notes/:id
//   POST   /credit-notes/:id/apply
//
// Pattern A on credit_notes. Allocations write via /apply, the
// recompute trigger keeps applied_cents and invoices.credit_allocated_cents
// synced. Each allocation row produces an auto-JE via 0024.

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
import { requireCaller } from '../../_shared/tenant.ts';
import {
  CreditNoteSchema,
  CreditNoteAllocationSchema,
  type CreditNote,
  type CreditNoteAllocation,
} from '../../_shared/types/finance.ts';
import { requireFinanceCap, BUNDLE } from '../_helpers.ts';

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
  requireFinanceCap(caller, 'credit_notes.read');

  const limit = parseLimit(url);
  const cursor = decodeCursor(url.searchParams.get('cursor'));
  const status = url.searchParams.get('status');

  let query = admin()
    .from('credit_notes')
    .select(CN_COLS)
    .eq('org_id', caller.orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);

  if (status) query = query.eq('status', status);
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
  const rows = (data ?? []) as Array<{ id: string; created_at: string }>;
  const { items, next_cursor } = paginate(rows, limit);
  return ok(items.map(rowToCN), next_cursor ? { next_cursor } : undefined);
}

export async function getCreditNote({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  requireFinanceCap(caller, 'credit_notes.read');
  const id = parseUuidParam(params.id!);
  return ok(rowToCN(await fetchCN(caller.orgId, id)));
}

export async function createCreditNote(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  requireFinanceCap(caller, 'credit_notes.write');
  const body = await parseBody(ctx.req, CreditNoteCreateSchema);
  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    `${ctx.req.method} /credit-notes`,
    body,
    async () => {
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
  requireFinanceCap(caller, 'credit_notes.write');
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
  requireFinanceCap(caller, 'credit_notes.delete');
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
  requireFinanceCap(caller, 'credit_notes.apply');
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
