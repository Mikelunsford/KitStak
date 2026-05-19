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
} from '../_shared/handler-helpers.ts';
import { ApiError, ok } from '../_shared/responses.ts';
import { requireCaller } from '../_shared/tenant.ts';
import { hasCrossCuttingCap } from '../_shared/capabilities/cross_cutting.ts';
import {
  ImportValidateRequestSchema,
  ImportCommitRequestSchema,
  ImportEntityTypeSchema,
  type ImportRowError,
} from '../_shared/types/cross_cutting.ts';
import { z } from 'zod';

const BUNDLE = 'imports-api';

// Per-entity row schemas. We tolerate unknown extra fields so operators can
// upload broader CSVs without rejection; we only validate the columns we
// actually use for insert.
const RowSchemas: Record<string, z.ZodTypeAny> = {
  customer: z.object({
    display_name: z.string().min(1),
    email: z.string().email().optional().nullable(),
    phone: z.string().optional().nullable(),
  }),
  item: z.object({
    sku: z.string().min(1),
    name: z.string().min(1),
    unit_of_measure: z.string().optional().nullable(),
  }),
  vendor: z.object({
    display_name: z.string().min(1),
    email: z.string().email().optional().nullable(),
  }),
  invoice: z.object({
    number: z.string().min(1),
    customer_id: z.string().uuid(),
    total_cents: z.number().int().nonnegative(),
    currency_code: z.string().min(3).max(3),
  }),
  expense: z.object({
    number: z.string().min(1),
    vendor_id: z.string().uuid(),
    amount_cents: z.number().int().nonnegative(),
    currency_code: z.string().min(3).max(3),
  }),
};

const TableForEntity: Record<string, string> = {
  customer: 'customers',
  item: 'items',
  vendor: 'vendors',
  invoice: 'invoices',
  expense: 'expenses',
};

function validateRows(
  entity: string,
  rows: Array<Record<string, unknown>>,
): { errors: ImportRowError[]; validIdx: Set<number> } {
  const schema = RowSchemas[entity];
  const errors: ImportRowError[] = [];
  const validIdx = new Set<number>();
  if (!schema) {
    return { errors: [{ row_number: 0, field: null, message: 'unsupported entity' }], validIdx };
  }
  rows.forEach((row, i) => {
    const parsed = schema.safeParse(row);
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
      validIdx.add(i);
    }
  });
  return { errors, validIdx };
}

const validate: Route = {
  method: 'POST',
  path: '/imports/:entity/validate',
  async handler({ req, params }) {
    const caller = requireCaller(req);
    if (!hasCrossCuttingCap(caller.role, 'imports.job.validate')) {
      throw new ApiError('FORBIDDEN', 403, 'caller lacks capability: imports.job.validate');
    }
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
        const { errors, validIdx } = validateRows(entity.data, body.rows);
        return ok({
          total_rows: body.rows.length,
          valid_rows: validIdx.size,
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
    if (!hasCrossCuttingCap(caller.role, 'imports.job.commit')) {
      throw new ApiError('FORBIDDEN', 403, 'caller lacks capability: imports.job.commit');
    }
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
        const { errors, validIdx } = validateRows(entity.data, body.rows);
        const table = TableForEntity[entity.data];
        if (!table) throw new ApiError('NOT_FOUND', 404);
        const insertRows = body.rows
          .map((r, i) => ({ ...r, org_id: caller.orgId, idx: i }))
          .filter((r) => validIdx.has(r.idx as number))
          .map(({ idx: _idx, ...r }) => r);
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
