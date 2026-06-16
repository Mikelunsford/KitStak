// imports-api: validate-then-commit CSV import.
//
//   POST /imports/<entity>/validate  -> { total_rows, valid_rows, errors }
//   POST /imports/<entity>/commit    -> { inserted, errors }
//
// Sync-only at v1 per the audit. The body is JSON with parsed rows; the SPA
// converts the operator's CSV upload into the JSON shape before posting.

import { route, type Route } from '../_shared/route.ts';
import {
  admin,
  parseBody,
  respondWithIdempotency,
  requireCap,
} from '../_shared/handler-helpers.ts';
import { assertRefsInOrg } from '../_shared/crud.ts';
import { ApiError, ok } from '../_shared/responses.ts';
import { requireCaller } from '../_shared/tenant.ts';
import {
  ImportValidateRequestSchema,
  ImportCommitRequestSchema,
  ImportEntityTypeSchema,
  type ImportRowError,
} from '../_shared/types/cross_cutting.ts';
import { z } from 'zod';

const BUNDLE = 'imports-api';

// Per-entity row schemas. The KEYS here are the real destination-table column
// names, because the commit handler inserts the Zod-parsed row directly (the
// allowlist). A drift between a schema key and the actual column silently
// dropped the value (Zod stripped the unknown key) or failed the insert, which
// is why the import round-trip was broken for several entities before this fix.
//
// We tolerate unknown extra fields so operators can upload broader CSVs without
// rejection; only the declared columns reach the insert.
const RowSchemas: Record<string, z.ZodTypeAny> = {
  customer: z.object({
    display_name: z.string().min(1),
    // customers stores contact details under primary_* (migration 0007).
    primary_email: z.string().email().optional().nullable(),
    primary_phone: z.string().optional().nullable(),
  }),
  item: z.object({
    // items has no free-text unit-of-measure column; unit_id is a UUID FK to
    // public.units (migration 0012). A CSV UOM string cannot map to that FK
    // without a lookup, so unit is intentionally out of scope for import here.
    sku: z.string().min(1),
    name: z.string().min(1),
  }),
  vendor: z.object({
    // vendors already uses email / phone (migration 0025), so these are the
    // real column names, not aliases.
    display_name: z.string().min(1),
    email: z.string().email().optional().nullable(),
    phone: z.string().optional().nullable(),
  }),
  invoice: z.object({
    invoice_number: z.string().min(1),
    customer_id: z.string().uuid(),
    // CSV cells arrive as strings; coerce to an integer cent value. Stays
    // BIGINT cents (never a float) per the money rules.
    total_cents: z.coerce.number().int().nonnegative(),
    currency_code: z.string().min(3).max(3),
  }),
  expense: z.object({
    expense_number: z.string().min(1),
    vendor_id: z.string().uuid(),
    amount_cents: z.coerce.number().int().nonnegative(),
    currency_code: z.string().min(3).max(3),
  }),
};

// Friendly CSV header -> real column name, per entity. This lets an operator
// keep a natural CSV header (email, phone, number) while the insert still uses
// the canonical column. Aliasing runs BEFORE Zod parse; an explicit canonical
// value already present on the row wins over the alias. This does NOT widen the
// allowlist: anything not in the entity RowSchema is still stripped by Zod
// before the insert, so a CSV cannot set an arbitrary DB field.
const ColumnAliases: Record<string, Record<string, string>> = {
  customer: { email: 'primary_email', phone: 'primary_phone' },
  invoice: { number: 'invoice_number' },
  expense: { number: 'expense_number' },
};

function applyColumnAliases(
  entity: string,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const aliases = ColumnAliases[entity];
  if (!aliases) return row;
  const mapped: Record<string, unknown> = { ...row };
  for (const [from, to] of Object.entries(aliases)) {
    // Only fill the canonical column from the alias when the canonical column
    // is not already supplied; never overwrite an explicit canonical value.
    if (from in mapped && !(to in mapped && mapped[to] !== undefined && mapped[to] !== '')) {
      mapped[to] = mapped[from];
    }
    delete mapped[from];
  }
  return mapped;
}

const TableForEntity: Record<string, string> = {
  customer: 'customers',
  item: 'items',
  vendor: 'vendors',
  invoice: 'invoices',
  expense: 'expenses',
};

// Org-scoped foreign-key columns per importable entity, mapped to the table
// each id must belong to within the caller org. Only columns DECLARED in the
// RowSchemas reach the insert (the commit handler inserts the Zod-parsed row,
// not the raw row), so this lists just the schema-declared FK columns;
// undeclared FK columns are stripped before insert and need no check. Distinct
// non-null ids per field are validated in a single batched query.
const ForeignKeysForEntity: Record<string, Record<string, string>> = {
  invoice: { customer_id: 'customers' },
  expense: { vendor_id: 'vendors' },
};

async function assertRowRefsInOrg(
  entity: string,
  caller: Parameters<typeof assertRefsInOrg>[1],
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  const fkFields = ForeignKeysForEntity[entity];
  if (!fkFields) return;
  for (const [field, table] of Object.entries(fkFields)) {
    const ids = rows
      .map((row) => row[field])
      .filter((v): v is string => typeof v === 'string' && v.length > 0);
    await assertRefsInOrg(table, caller, ids);
  }
}

function validateRows(
  entity: string,
  rows: Array<Record<string, unknown>>,
): { errors: ImportRowError[]; validRows: Array<Record<string, unknown>> } {
  const schema = RowSchemas[entity];
  const errors: ImportRowError[] = [];
  const validRows: Array<Record<string, unknown>> = [];
  if (!schema) {
    return { errors: [{ row_number: 0, field: null, message: 'unsupported entity' }], validRows };
  }
  rows.forEach((row, i) => {
    // Map friendly CSV headers to canonical columns, then drop empty-string
    // cells so an unfilled optional column parses as absent rather than failing
    // a format check (a blank email cell is "not provided", not "invalid").
    const aliased = applyColumnAliases(entity, row);
    const normalized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(aliased)) {
      if (typeof v === 'string' && v.trim() === '') continue;
      normalized[k] = v;
    }
    const parsed = schema.safeParse(normalized);
    if (!parsed.success) {
      const flat = parsed.error.flatten();
      for (const [field, msgs] of Object.entries(flat.fieldErrors)) {
        for (const msg of msgs ?? []) {
          errors.push({ row_number: i + 1, field, message: msg });
        }
      }
      if (flat.formErrors.length > 0) {
        for (const msg of flat.formErrors) {
          errors.push({ row_number: i + 1, field: null, message: msg });
        }
      }
    } else {
      // Push the Zod-parsed row (unknown fields stripped) so the commit insert
      // is an allowlist of declared columns, not the raw client payload.
      validRows.push(parsed.data as Record<string, unknown>);
    }
  });
  return { errors, validRows };
}

const validate: Route = {
  method: 'POST',
  path: '/imports/:entity/validate',
  async handler({ req, params }) {
    const caller = requireCaller(req);
    requireCap(caller, 'imports.job.validate');
    const entity = ImportEntityTypeSchema.safeParse(params.entity);
    if (!entity.success) throw new ApiError('NOT_FOUND', 404);

    const body = await parseBody(req, ImportValidateRequestSchema);
    if (body.entity_type !== entity.data) {
      throw new ApiError(
        'VALIDATION_ERROR',
        422,
        'entity_type in body must match path',
      );
    }

    return respondWithIdempotency(
      req,
      caller,
      BUNDLE,
      '/imports/:entity/validate',
      body,
      async () => {
        const { errors, validRows } = validateRows(entity.data, body.rows);
        return ok({
          total_rows: body.rows.length,
          valid_rows: validRows.length,
          errors,
        });
      },
    );
  },
};

const commit: Route = {
  method: 'POST',
  path: '/imports/:entity/commit',
  async handler({ req, params }) {
    const caller = requireCaller(req);
    requireCap(caller, 'imports.job.commit');
    const entity = ImportEntityTypeSchema.safeParse(params.entity);
    if (!entity.success) throw new ApiError('NOT_FOUND', 404);
    const body = await parseBody(req, ImportCommitRequestSchema);
    if (body.entity_type !== entity.data) {
      throw new ApiError('VALIDATION_ERROR', 422, 'entity_type in body must match path');
    }

    return respondWithIdempotency(
      req,
      caller,
      BUNDLE,
      '/imports/:entity/commit',
      body,
      async () => {
        const { errors, validRows } = validateRows(entity.data, body.rows);
        const table = TableForEntity[entity.data];
        if (!table) throw new ApiError('NOT_FOUND', 404);
        // Reject any cross-tenant foreign-key id before the bulk insert. A 404
        // from assertRefsInOrg aborts the commit so no rows are written.
        await assertRowRefsInOrg(entity.data, caller, validRows);
        // Allowlist insert: validRows holds the Zod-parsed rows (unknown fields
        // already stripped), so the spread carries only declared columns. The
        // server sets org and audit columns; a client cannot inject created_by,
        // id, status, or any other column through the import payload.
        const insertRows = validRows.map((r) => ({
          ...r,
          org_id: caller.orgId,
          created_by: caller.userId,
          updated_by: caller.userId,
        }));
        let inserted = 0;
        if (insertRows.length > 0) {
          const { error, count } = await admin()
            .from(table)
            .insert(insertRows, { count: 'exact' });
          if (error) {
            errors.push({ row_number: 0, field: null, message: error.message });
          } else {
            inserted = count ?? insertRows.length;
          }
        }
        return ok({ inserted, errors });
      },
    );
  },
};

Deno.serve((req) => route(req, [validate, commit], { bundle: BUNDLE }));

export { validate, commit };
