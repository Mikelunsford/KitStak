// exports-api: GET /exports/<entity>?format=csv
//
// Streams a CSV of the given entity scoped to caller.orgId. Currency cents
// columns are emitted as integer strings to preserve precision per the
// constitution's wire rule.

import { route, type Route } from '../_shared/route.ts';
import { admin } from '../_shared/handler-helpers.ts';
import { ApiError } from '../_shared/responses.ts';
import { requireCaller } from '../_shared/tenant.ts';
import { hasCrossCuttingCap } from '../_shared/capabilities/cross_cutting.ts';
import { corsHeaders } from '../_shared/cors.ts';

const BUNDLE = 'exports-api';

const EXPORTABLE: Record<string, { table: string; columns: string[] }> = {
  customer: {
    table: 'customers',
    columns: ['id', 'display_name', 'email', 'phone', 'created_at'],
  },
  invoice: {
    table: 'invoices',
    columns: [
      'id',
      'number',
      'customer_id',
      'status',
      'issued_at',
      'due_at',
      'total_cents',
      'balance_cents',
      'currency_code',
    ],
  },
  payment: {
    table: 'payments',
    columns: [
      'id',
      'invoice_id',
      'received_at',
      'amount_cents',
      'currency_code',
      'method',
    ],
  },
  journal_entry: {
    table: 'journal_entries',
    columns: ['id', 'number', 'status', 'posted_at', 'memo'],
  },
  expense: {
    table: 'expenses',
    columns: [
      'id',
      'number',
      'vendor_id',
      'status',
      'incurred_at',
      'amount_cents',
      'currency_code',
    ],
  },
  stock_movement: {
    table: 'stock_movements',
    columns: [
      'id',
      'item_id',
      'warehouse_id',
      'movement_type',
      'quantity',
      'moved_at',
    ],
  },
  shipment: {
    table: 'shipments',
    columns: ['id', 'number', 'status', 'shipped_at', 'carrier'],
  },
  vendor_bill: {
    table: 'vendor_bills',
    columns: [
      'id',
      'number',
      'vendor_id',
      'status',
      'issued_at',
      'due_at',
      'total_cents',
      'currency_code',
    ],
  },
};

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const exportEntity: Route = {
  method: 'GET',
  path: '/exports/:entity',
  async handler({ req, url, params }) {
    const caller = requireCaller(req);
    if (!hasCrossCuttingCap(caller.role, 'exports.job.create')) {
      throw new ApiError('FORBIDDEN', 403, 'caller lacks capability: exports.job.create');
    }
    const format = url.searchParams.get('format') ?? 'csv';
    if (format !== 'csv') {
      throw new ApiError('VALIDATION_ERROR', 422, 'only format=csv is supported');
    }
    const entity = params.entity;
    const spec = EXPORTABLE[entity];
    if (!spec) {
      throw new ApiError('NOT_FOUND', 404);
    }

    const { data, error } = await admin()
      .from(spec.table)
      .select(spec.columns.join(','))
      .eq('org_id', caller.orgId)
      .order('created_at', { ascending: false })
      .limit(10_000);

    if (error) {
      throw new ApiError('INTERNAL_ERROR', 500, error.message);
    }

    const header = spec.columns.join(',');
    const lines = [header];
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      lines.push(spec.columns.map((c) => csvEscape(row[c])).join(','));
    }
    const csv = lines.join('\n') + '\n';

    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${entity}-export.csv"`,
        'x-request-id': crypto.randomUUID(),
        ...corsHeaders(),
      },
    });
  },
};

Deno.serve((req) => route(req, [exportEntity], { bundle: BUNDLE }));

export { exportEntity, EXPORTABLE };
