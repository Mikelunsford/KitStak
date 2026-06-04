// finance-api journal_entries handlers.
//   GET    /journal-entries
//   POST   /journal-entries
//   GET    /journal-entries/:id
//   PATCH  /journal-entries/:id   (draft-only updates)
//   DELETE /journal-entries/:id   (draft-only)
//   POST   /journal-entries/:id/post   (calls post_journal_entry RPC)
//
// Every write is gated behind the per-route flag
// `finance.journal_entries.enabled`. Manual journal entries are accepted as a
// payload of {entry, lines[]} so the handler can insert both and call
// check_journal_balance before letting the trigger fire on transition to
// posted.

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
import { requireCaller } from '../../_shared/tenant.ts';
import { assertRefsInOrg } from '../../_shared/crud.ts';
import {
  JournalEntrySchema,
  JournalEntryLineSchema,
  JournalEntrySourceTypeSchema,
  type JournalEntry,
  type JournalEntryLine,
} from '../../_shared/types/finance.ts';
import { requireFinanceJeFlag, BUNDLE } from '../_helpers.ts';
import { requireCap } from '../../_shared/handler-helpers.ts';

const JE_COLS =
  'id, org_id, entry_number, entry_date, period_year, period_month, status, ' +
  'state_changed_at, source_type, source_id, memo, posted_at, reversed_at, ' +
  'reversal_of_id, created_at, updated_at';

const LINE_COLS =
  'id, entry_id, account_id, debit_cents, credit_cents, memo, sort_order, created_at';

const JeLineInputSchema = z.object({
  account_id: z.string().uuid(),
  debit_cents: z.union([z.number().int(), z.string().regex(/^-?\d+$/)]).default(0),
  credit_cents: z.union([z.number().int(), z.string().regex(/^-?\d+$/)]).default(0),
  memo: z.string().optional(),
  sort_order: z.number().int().default(0),
});

const JeCreateSchema = z.object({
  entry_number: z.string().min(1),
  entry_date: z.string(),
  period_year: z.number().int(),
  period_month: z.number().int().min(1).max(12),
  source_type: JournalEntrySourceTypeSchema.default('manual'),
  source_id: z.string().uuid().optional(),
  memo: z.string().optional(),
  lines: z.array(JeLineInputSchema).min(2),
});

const JePatchSchema = z.object({
  entry_number: z.string().min(1).optional(),
  entry_date: z.string().optional(),
  memo: z.string().optional(),
});

function rowToJe(row: unknown): JournalEntry {
  return JournalEntrySchema.parse(row);
}

function rowToLine(row: unknown): JournalEntryLine {
  return JournalEntryLineSchema.parse(row);
}

async function fetchJe(orgId: string, id: string) {
  const { data, error } = await admin()
    .from('journal_entries')
    .select(JE_COLS)
    .eq('id', id)
    .eq('org_id', orgId)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 500, 'je lookup failed', {
      detail: error.message,
    });
  }
  if (!data) throw new ApiError('NOT_FOUND', 404, 'journal entry not found');
  return data;
}

export async function listJournalEntries({ req, url }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  await requireFinanceJeFlag(caller);
  requireCap(caller, 'journal_entries.read');

  const limit = parseLimit(url);
  const cursor = decodeCursor(url.searchParams.get('cursor'));
  const status = url.searchParams.get('status');

  let query = admin()
    .from('journal_entries')
    .select(JE_COLS)
    .eq('org_id', caller.orgId)
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
    throw new ApiError('INTERNAL_ERROR', 500, 'je list failed', {
      detail: error.message,
    });
  }
  const rows = (data ?? []) as unknown as Array<{ id: string; created_at: string }>;
  const { items, next_cursor } = paginate(rows, limit);
  return ok(items.map(rowToJe), next_cursor ? { next_cursor } : undefined);
}

export async function getJournalEntry({ req, params }: RouteCtx): Promise<Response> {
  const caller = requireCaller(req);
  await requireFinanceJeFlag(caller);
  requireCap(caller, 'journal_entries.read');
  const id = parseUuidParam(params.id!);
  const entry = await fetchJe(caller.orgId, id);
  const { data: lines, error } = await admin()
    .from('journal_entry_lines')
    .select(LINE_COLS)
    .eq('entry_id', id)
    .order('sort_order', { ascending: true });
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 500, 'je line lookup failed', {
      detail: error.message,
    });
  }
  return ok({
    entry: rowToJe(entry),
    lines: (lines ?? []).map(rowToLine),
  });
}

export async function createJournalEntry(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  await requireFinanceJeFlag(caller);
  requireCap(caller, 'journal_entries.write');
  const body = await parseBody(ctx.req, JeCreateSchema);

  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    `${ctx.req.method} /journal-entries`,
    body,
    async () => {
      // Validate every line's account belongs to the caller's org before any
      // insert persists a cross-tenant reference. Batched into one query.
      // chart_of_accounts has no deleted_at column, so softDelete is off.
      await assertRefsInOrg(
        'chart_of_accounts',
        caller,
        body.lines.map((line) => line.account_id),
        { softDelete: false },
      );
      // source_id varies by source_type and may point at an external reference;
      // cross-tenant validation deferred.
      const insert = {
        org_id: caller.orgId,
        entry_number: body.entry_number,
        entry_date: body.entry_date,
        period_year: body.period_year,
        period_month: body.period_month,
        source_type: body.source_type,
        source_id: body.source_id ?? null,
        memo: body.memo ?? null,
        status: 'draft',
        created_by: caller.userId,
        updated_by: caller.userId,
      };
      const { data: entryRow, error: insertError } = await admin()
        .from('journal_entries')
        .insert(insert)
        .select(JE_COLS)
        .single();
      if (insertError) {
        if (insertError.message?.startsWith('period_closed:')) {
          throw new ApiError('VALIDATION_ERROR', 422, insertError.message);
        }
        throw new ApiError('INTERNAL_ERROR', 500, 'je insert failed', {
          detail: insertError.message,
        });
      }

      const entryId = (entryRow as unknown as { id: string }).id;
      const lineRows = body.lines.map((l) => ({
        entry_id: entryId,
        account_id: l.account_id,
        debit_cents: l.debit_cents,
        credit_cents: l.credit_cents,
        memo: l.memo ?? null,
        sort_order: l.sort_order,
      }));
      const { error: lineErr } = await admin()
        .from('journal_entry_lines')
        .insert(lineRows);
      if (lineErr) {
        throw new ApiError('INTERNAL_ERROR', 500, 'je line insert failed', {
          detail: lineErr.message,
        });
      }
      return created(rowToJe(entryRow));
    },
  );
}

export async function patchJournalEntry(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  await requireFinanceJeFlag(caller);
  requireCap(caller, 'journal_entries.write');
  const id = parseUuidParam(ctx.params.id!);
  const body = await parseBody(ctx.req, JePatchSchema);
  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    `${ctx.req.method} /journal-entries/:id`,
    body,
    async () => {
      const row = await fetchJe(caller.orgId, id) as unknown as { status?: string };
      if (row.status !== 'draft') {
        throw new ApiError(
          'STATE_CONFLICT',
          409,
          'only draft journal entries can be patched',
        );
      }
      const patch: Record<string, unknown> = { updated_by: caller.userId };
      for (const [k, v] of Object.entries(body)) {
        if (v !== undefined) patch[k] = v;
      }
      const { data, error } = await admin()
        .from('journal_entries')
        .update(patch)
        .eq('id', id)
        .eq('org_id', caller.orgId)
        .select(JE_COLS)
        .single();
      if (error) {
        throw new ApiError('INTERNAL_ERROR', 500, 'je update failed', {
          detail: error.message,
        });
      }
      return ok(rowToJe(data));
    },
  );
}

export async function deleteJournalEntry(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  await requireFinanceJeFlag(caller);
  requireCap(caller, 'journal_entries.delete');
  const id = parseUuidParam(ctx.params.id!);
  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    `${ctx.req.method} /journal-entries/:id`,
    null,
    async () => {
      const row = await fetchJe(caller.orgId, id) as unknown as { status?: string };
      if (row.status !== 'draft') {
        throw new ApiError(
          'STATE_CONFLICT',
          409,
          'only draft journal entries can be deleted',
        );
      }
      const { error } = await admin()
        .from('journal_entries')
        .delete()
        .eq('id', id)
        .eq('org_id', caller.orgId);
      if (error) {
        throw new ApiError('INTERNAL_ERROR', 500, 'je delete failed', {
          detail: error.message,
        });
      }
      return noContent();
    },
  );
}

export async function postJournalEntry(ctx: RouteCtx): Promise<Response> {
  const caller = requireCaller(ctx.req);
  await requireFinanceJeFlag(caller);
  requireCap(caller, 'journal_entries.post');
  const id = parseUuidParam(ctx.params.id!);
  return respondWithIdempotency(
    ctx.req,
    caller,
    BUNDLE,
    `${ctx.req.method} /journal-entries/:id/post`,
    null,
    async () => {
      await fetchJe(caller.orgId, id);
      const { error } = await admin().rpc('post_journal_entry', { p_entry_id: id });
      if (error) {
        if (error.message?.startsWith('VALIDATION_ERROR')) {
          throw new ApiError('VALIDATION_ERROR', 422, error.message);
        }
        if (error.message?.startsWith('STATE_CONFLICT')) {
          throw new ApiError('STATE_CONFLICT', 409, error.message);
        }
        if (error.message?.startsWith('NOT_FOUND')) {
          throw new ApiError('NOT_FOUND', 404, error.message);
        }
        if (error.message?.startsWith('period_closed:')) {
          throw new ApiError('VALIDATION_ERROR', 422, error.message);
        }
        throw new ApiError('INTERNAL_ERROR', 500, 'je post failed', {
          detail: error.message,
        });
      }
      const row = await fetchJe(caller.orgId, id);
      return ok(rowToJe(row));
    },
  );
}
