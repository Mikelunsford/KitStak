// imports-api: validate-then-commit CSV import.
//
//   POST /imports/<entity>/validate  -> { total_rows, valid_rows, errors }
//   POST /imports/<entity>/commit    -> { inserted, errors }
//
// Sync-only at v1 per the audit. The body is JSON with parsed rows; the SPA
// converts the operator's CSV upload into the JSON shape before posting.
//
// Pipeline per row: column-alias -> drop empty cells -> Zod (allowlist) ->
// per-entity post-transform (customer address/tags) -> async FK-by-name
// resolution (item category/unit/tax). Only declared, parsed, resolved columns
// reach the insert; the server sets org and audit columns.

import { route, type Route } from '../_shared/route.ts';
import {
  admin,
  parseBody,
  respondWithIdempotency,
  requireCap,
} from '../_shared/handler-helpers.ts';
import { assertRefsInOrg } from '../_shared/crud.ts';
import { ApiError, internalError, ok } from '../_shared/responses.ts';
import { requireCaller } from '../_shared/tenant.ts';
import {
  ImportValidateRequestSchema,
  ImportCommitRequestSchema,
  ImportEntityTypeSchema,
  type ImportRowError,
} from '../_shared/types/cross_cutting.ts';
import { z } from 'zod';

const BUNDLE = 'imports-api';

// Per-row errors stored on the import_jobs ledger are capped to bound row size;
// the full count is kept separately in error_count.
const ERROR_SAMPLE_CAP = 50;

// Recent import-history rows returned by GET /imports/jobs.
const JOBS_PAGE_LIMIT = 50;

// CSV booleans: tolerate the common truthy/falsey spellings an operator types
// in a spreadsheet. Unrecognized values fall through to z.boolean(), which
// errors with a clear per-field message. Empty cells are dropped upstream, so
// an absent boolean column parses as not-provided (the DB default applies).
const csvBool = z.preprocess((v) => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 't'].includes(s)) return true;
    if (['false', '0', 'no', 'n', 'f'].includes(s)) return false;
  }
  return v;
}, z.boolean());

const cents = z.coerce.number().int().nonnegative();

// Per-entity row schemas. The KEYS here are the real destination-table column
// names (or, for FK-by-name and flattened addresses, intermediate keys that the
// post-transform / resolver convert to real columns), because the commit
// handler inserts the parsed+transformed row directly (the allowlist). We
// tolerate unknown extra fields so operators can upload broader CSVs without
// rejection; only the declared columns reach the insert.
const RowSchemas: Record<string, z.ZodTypeAny> = {
  customer: z.object({
    display_name: z.string().min(1),
    // customers stores contact details under primary_* (migration 0007).
    primary_email: z.string().email().optional().nullable(),
    primary_phone: z.string().optional().nullable(),
    kind: z.enum(['company', 'individual']).default('company'),
    tax_id: z.string().max(64).optional().nullable(),
    default_currency_code: z.string().length(3).optional(),
    default_payment_terms_days: z.coerce
      .number()
      .int()
      .nonnegative()
      .optional()
      .nullable(),
    // Flattened address cells; customerTransform assembles them into the
    // billing_address / shipping_address jsonb columns and drops these keys.
    billing_line1: z.string().optional().nullable(),
    billing_line2: z.string().optional().nullable(),
    billing_city: z.string().optional().nullable(),
    billing_region: z.string().optional().nullable(),
    billing_postal: z.string().optional().nullable(),
    billing_country: z.string().optional().nullable(),
    shipping_line1: z.string().optional().nullable(),
    shipping_line2: z.string().optional().nullable(),
    shipping_city: z.string().optional().nullable(),
    shipping_region: z.string().optional().nullable(),
    shipping_postal: z.string().optional().nullable(),
    shipping_country: z.string().optional().nullable(),
    // Semicolon-delimited in the CSV; customerTransform splits to text[].
    tags: z.string().optional(),
  }),
  item: z.object({
    sku: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional().nullable(),
    kind: z.enum(['product', 'service', 'kit', 'subscription', 'bundle']).optional(),
    // Money stays integer minor units (BIGINT cents), never a float.
    unit_price_cents: cents.optional(),
    unit_cost_cents: cents.optional().nullable(),
    currency_code: z.string().length(3).optional(),
    // Free-text unit-of-measure label (migrations 0031 + 0115). Distinct from
    // the unit_id FK, which is resolved by name below via the `unit` column.
    unit_of_measure: z.string().optional().nullable(),
    reorder_point: z.coerce.number().nonnegative().optional().nullable(),
    barcode: z.string().optional().nullable(),
    supply_source: z
      .enum(['in_house', 'customer_supplied', 'vendor_consigned', 'third_party_consigned'])
      .optional(),
    is_active: csvBool.optional(),
    is_taxable: csvBool.optional(),
    is_sellable: csvBool.optional(),
    is_purchasable: csvBool.optional(),
    // FK-by-name: resolved to category_id / unit_id / default_tax_id against the
    // caller org's lookup tables, then stripped. See LookupResolvers.
    category: z.string().optional().nullable(),
    unit: z.string().optional().nullable(),
    tax: z.string().optional().nullable(),
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
    total_cents: cents,
    currency_code: z.string().min(3).max(3),
  }),
  expense: z.object({
    expense_number: z.string().min(1),
    vendor_id: z.string().uuid(),
    amount_cents: cents,
    currency_code: z.string().min(3).max(3),
  }),
};

// Friendly CSV header -> real column name, per entity. Aliasing runs BEFORE Zod
// parse; an explicit canonical value already present on the row wins over the
// alias. This does NOT widen the allowlist: anything not in the entity
// RowSchema is still stripped by Zod before the insert.
const ColumnAliases: Record<string, Record<string, string>> = {
  customer: {
    email: 'primary_email',
    phone: 'primary_phone',
    currency: 'default_currency_code',
    payment_terms_days: 'default_payment_terms_days',
  },
  item: {
    price: 'unit_price_cents',
    cost: 'unit_cost_cents',
    currency: 'currency_code',
    uom: 'unit_of_measure',
  },
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
    if (from in mapped && !(to in mapped && mapped[to] !== undefined && mapped[to] !== '')) {
      mapped[to] = mapped[from];
    }
    delete mapped[from];
  }
  return mapped;
}

// Per-entity synchronous post-Zod transform: reshape parsed scalar cells into
// the real column shapes (nested jsonb, arrays) before insert.
const PostTransforms: Record<string, (data: Record<string, unknown>) => Record<string, unknown>> = {
  customer(data) {
    const out: Record<string, unknown> = { ...data };
    for (const prefix of ['billing', 'shipping'] as const) {
      const addr: Record<string, unknown> = {};
      for (const part of ['line1', 'line2', 'city', 'region', 'postal', 'country'] as const) {
        const key = `${prefix}_${part}`;
        const val = out[key];
        if (typeof val === 'string' && val.trim() !== '') addr[part] = val;
        delete out[key];
      }
      if (Object.keys(addr).length > 0) out[`${prefix}_address`] = addr;
    }
    const rawTags = out.tags;
    if (typeof rawTags === 'string') {
      const tags = rawTags
        .split(';')
        .map((t) => t.trim())
        .filter((t) => t.length > 0);
      if (tags.length > 0) out.tags = tags;
      else delete out.tags;
    }
    return out;
  },
};

const TableForEntity: Record<string, string> = {
  customer: 'customers',
  item: 'items',
  vendor: 'vendors',
  invoice: 'invoices',
  expense: 'expenses',
};

// FK-by-name resolvers: a CSV value (the `field` column) is matched against the
// caller org's lookup table on any of `matchCols` (case-insensitive, active
// rows only), then replaced with the destination `idColumn`. A miss or an
// ambiguous match becomes a per-row error and drops the row from the insert.
interface LookupResolver {
  field: string;
  table: string;
  idColumn: string;
  matchCols: string[];
  label: string;
}

const LookupResolvers: Record<string, LookupResolver[]> = {
  item: [
    { field: 'category', table: 'item_categories', idColumn: 'category_id', matchCols: ['code', 'name'], label: 'category' },
    { field: 'unit', table: 'units', idColumn: 'unit_id', matchCols: ['code', 'label'], label: 'unit' },
    { field: 'tax', table: 'taxes', idColumn: 'default_tax_id', matchCols: ['code', 'name'], label: 'tax' },
  ],
};

// Org-scoped raw-UUID foreign keys (invoice/expense). Item FKs are resolved
// by name above against the caller org, so they are in-org by construction and
// are not re-checked here.
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

interface RowState {
  rowNumber: number;
  data: Record<string, unknown> | null;
}

function pushZodErrors(
  errors: ImportRowError[],
  rowNumber: number,
  error: z.ZodError,
): void {
  const flat = error.flatten();
  for (const [field, msgs] of Object.entries(flat.fieldErrors)) {
    for (const msg of msgs ?? []) errors.push({ row_number: rowNumber, field, message: msg });
  }
  for (const msg of flat.formErrors) {
    errors.push({ row_number: rowNumber, field: null, message: msg });
  }
}

// Resolve every FK-by-name field for an entity, mutating row states (set the
// id column / null the row on failure) and appending per-row errors.
async function resolveLookups(
  entity: string,
  caller: { orgId: string },
  states: RowState[],
  errors: ImportRowError[],
): Promise<void> {
  const resolvers = LookupResolvers[entity];
  if (!resolvers) return;
  for (const r of resolvers) {
    const needed = states.some(
      (s) => s.data && typeof s.data[r.field] === 'string' && (s.data[r.field] as string).trim() !== '',
    );
    if (!needed) {
      for (const s of states) if (s.data) delete s.data[r.field];
      continue;
    }
    const { data: lookupRows, error } = await admin()
      .from(r.table)
      .select(['id', ...r.matchCols].join(','))
      .eq('org_id', caller.orgId)
      .is('deleted_at', null);
    if (error) throw internalError(BUNDLE, error);

    // value (lowercased) -> set of distinct ids it could mean.
    const byKey = new Map<string, Set<string>>();
    for (const lr of (lookupRows ?? []) as unknown as Array<Record<string, unknown>>) {
      const id = String(lr.id);
      for (const col of r.matchCols) {
        const key = String(lr[col] ?? '').trim().toLowerCase();
        if (!key) continue;
        const set = byKey.get(key) ?? new Set<string>();
        set.add(id);
        byKey.set(key, set);
      }
    }

    for (const s of states) {
      if (!s.data) continue;
      const raw = s.data[r.field];
      if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
        delete s.data[r.field];
        continue;
      }
      const key = String(raw).trim().toLowerCase();
      const ids = byKey.get(key);
      if (!ids || ids.size === 0) {
        errors.push({ row_number: s.rowNumber, field: r.field, message: `${r.label} "${raw}" not found` });
        s.data = null;
        continue;
      }
      if (ids.size > 1) {
        errors.push({
          row_number: s.rowNumber,
          field: r.field,
          message: `${r.label} "${raw}" is ambiguous (matches ${ids.size})`,
        });
        s.data = null;
        continue;
      }
      s.data[r.idColumn] = [...ids][0];
      delete s.data[r.field];
    }
  }
}

// Full validate pipeline shared by both /validate (dry-run) and /commit. Runs
// Zod, the per-entity transform, then FK-by-name resolution, returning the
// flattened errors and the rows that survived every stage.
async function validateAndResolve(
  entity: string,
  caller: { orgId: string },
  rows: Array<Record<string, unknown>>,
): Promise<{ errors: ImportRowError[]; validRows: Array<Record<string, unknown>> }> {
  const schema = RowSchemas[entity];
  if (!schema) {
    return { errors: [{ row_number: 0, field: null, message: 'unsupported entity' }], validRows: [] };
  }
  const transform = PostTransforms[entity];
  const errors: ImportRowError[] = [];
  const states: RowState[] = [];

  rows.forEach((row, i) => {
    const rowNumber = i + 1;
    const aliased = applyColumnAliases(entity, row);
    // Drop empty-string cells so an unfilled optional column parses as absent
    // rather than failing a format check.
    const normalized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(aliased)) {
      if (typeof v === 'string' && v.trim() === '') continue;
      normalized[k] = v;
    }
    const parsed = schema.safeParse(normalized);
    if (!parsed.success) {
      pushZodErrors(errors, rowNumber, parsed.error);
      states.push({ rowNumber, data: null });
      return;
    }
    const data = parsed.data as Record<string, unknown>;
    states.push({ rowNumber, data: transform ? transform(data) : data });
  });

  await resolveLookups(entity, caller, states, errors);

  errors.sort((a, b) => a.row_number - b.row_number);
  const validRows = states
    .filter((s): s is RowState & { data: Record<string, unknown> } => s.data !== null)
    .map((s) => s.data);
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
      throw new ApiError('VALIDATION_ERROR', 422, 'entity_type in body must match path');
    }

    return respondWithIdempotency(
      req,
      caller,
      BUNDLE,
      '/imports/:entity/validate',
      body,
      async () => {
        const { errors, validRows } = await validateAndResolve(entity.data, caller, body.rows);
        return ok({ total_rows: body.rows.length, valid_rows: validRows.length, errors });
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
        const { errors, validRows } = await validateAndResolve(entity.data, caller, body.rows);
        const table = TableForEntity[entity.data];
        if (!table) throw new ApiError('NOT_FOUND', 404);
        // Reject any cross-tenant raw-UUID foreign-key id before the bulk
        // insert. A 404 from assertRefsInOrg aborts the commit so no rows are
        // written.
        await assertRowRefsInOrg(entity.data, caller, validRows);
        // Allowlist insert: validRows holds parsed + transformed + resolved
        // rows, so the spread carries only declared/derived columns. The server
        // sets org and audit columns; a client cannot inject created_by, id,
        // status, or any other column through the import payload.
        const insertRows = validRows.map((r) => ({
          ...r,
          org_id: caller.orgId,
          created_by: caller.userId,
          updated_by: caller.userId,
        }));
        let inserted = 0;
        let insertFailed = false;
        if (insertRows.length > 0) {
          const { error, count } = await admin()
            .from(table)
            .insert(insertRows, { count: 'exact' });
          if (error) {
            errors.push({ row_number: 0, field: null, message: error.message });
            insertFailed = true;
          } else {
            inserted = count ?? insertRows.length;
          }
        }

        // Record the run in the import_jobs history ledger. Best-effort: a
        // failure to write history must not fail an import whose rows already
        // committed, but it is surfaced in the response rather than swallowed.
        // Runs inside respondWithIdempotency, so a replayed commit returns the
        // stored response without writing a duplicate job row.
        const { error: jobErr } = await admin().from('import_jobs').insert({
          org_id: caller.orgId,
          entity_type: entity.data,
          status: insertFailed ? 'failed' : 'completed',
          total_rows: body.rows.length,
          valid_rows: validRows.length,
          inserted_rows: inserted,
          error_count: errors.length,
          errors: errors.slice(0, ERROR_SAMPLE_CAP),
          created_by: caller.userId,
          completed_at: new Date().toISOString(),
        });
        if (jobErr) {
          errors.push({
            row_number: 0,
            field: null,
            message: `import recorded but history write failed: ${jobErr.message}`,
          });
        }
        return ok({ inserted, errors });
      },
    );
  },
};

// GET /imports/jobs: the org's recent import-history ledger, newest first.
// Gated on imports.job.validate (the import audience); org-scoped read.
const listJobs: Route = {
  method: 'GET',
  path: '/imports/jobs',
  async handler({ req }) {
    const caller = requireCaller(req);
    requireCap(caller, 'imports.job.validate');
    const { data, error } = await admin()
      .from('import_jobs')
      .select(
        'id, org_id, entity_type, status, total_rows, valid_rows, inserted_rows, error_count, errors, created_at, created_by, completed_at',
      )
      .eq('org_id', caller.orgId)
      .order('created_at', { ascending: false })
      .limit(JOBS_PAGE_LIMIT);
    if (error) throw internalError(BUNDLE, error);
    return ok(data ?? []);
  },
};

Deno.serve((req) => route(req, [listJobs, validate, commit], { bundle: BUNDLE }));

export { validate, commit, listJobs };
