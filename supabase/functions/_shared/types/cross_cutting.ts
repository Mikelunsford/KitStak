// Cross-cutting Zod canon. Byte-mirror of
// apps/web/src/lib/types/cross_cutting.ts. The contract test asserts the two
// files match exactly. A drift is a release blocker.
//
// Schemas exported here cover the seven cross-cutting surfaces shipped by
// Agent F: audit log, attachments, comments, notifications, saved views,
// search, dashboard, imports, exports, customer portal, PDF.

import { z } from 'zod';

export const UuidSchema = z.string().uuid();

// ---------------------------------------------------------------------------
// AuditLog
// ---------------------------------------------------------------------------
export const AuditLogSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  entity_type: z.string(),
  entity_id: UuidSchema,
  from_state: z.string().nullable(),
  to_state: z.string(),
  action: z.string().nullable(),
  triggered_by: UuidSchema.nullable(),
  triggered_at: z.string(),
  diff_json: z.record(z.unknown()).nullable(),
  prev_hash: z.string().nullable(),
  payload_hash: z.string().nullable(),
});
export type AuditLog = z.infer<typeof AuditLogSchema>;

// ---------------------------------------------------------------------------
// Attachment
// ---------------------------------------------------------------------------
export const AttachmentSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  entity_type: z.string(),
  entity_id: UuidSchema,
  storage_path: z.string(),
  file_name: z.string(),
  content_type: z.string().nullable(),
  size_bytes: z.union([z.number().int(), z.string().regex(/^-?\d+$/)]),
  uploaded_by: UuidSchema.nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
});
export type Attachment = z.infer<typeof AttachmentSchema>;

export const AttachmentCreateSchema = z.object({
  entity_type: z.string().min(1),
  entity_id: UuidSchema,
  storage_path: z.string().min(1),
  file_name: z.string().min(1),
  content_type: z.string().nullable().optional(),
  size_bytes: z.number().int().nonnegative().default(0),
});
export type AttachmentCreate = z.infer<typeof AttachmentCreateSchema>;

// ---------------------------------------------------------------------------
// Comment
// ---------------------------------------------------------------------------
export const CommentSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  entity_type: z.string(),
  entity_id: UuidSchema,
  parent_id: UuidSchema.nullable(),
  author_id: UuidSchema,
  body: z.string(),
  is_internal: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
});
export type Comment = z.infer<typeof CommentSchema>;

export const CommentCreateSchema = z.object({
  entity_type: z.string().min(1),
  entity_id: UuidSchema,
  body: z.string().min(1),
  parent_id: UuidSchema.nullable().optional(),
  is_internal: z.boolean().default(true),
});
export type CommentCreate = z.infer<typeof CommentCreateSchema>;

// ---------------------------------------------------------------------------
// Notification
// ---------------------------------------------------------------------------
export const NotificationChannelSchema = z.enum(['inapp', 'email', 'webhook']);
export type NotificationChannel = z.infer<typeof NotificationChannelSchema>;

export const NotificationSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  recipient_user_id: UuidSchema,
  entity_type: z.string().nullable(),
  entity_id: UuidSchema.nullable(),
  channel: NotificationChannelSchema,
  subject: z.string(),
  body: z.string().nullable(),
  payload: z.record(z.unknown()),
  queued_at: z.string(),
  delivered_at: z.string().nullable(),
  read_at: z.string().nullable(),
});
export type Notification = z.infer<typeof NotificationSchema>;

// ---------------------------------------------------------------------------
// SavedView
// ---------------------------------------------------------------------------
export const SavedViewSchema = z.object({
  id: UuidSchema,
  org_id: UuidSchema,
  owner_user_id: UuidSchema,
  entity_type: z.string(),
  name: z.string(),
  config: z.record(z.unknown()),
  is_shared: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type SavedView = z.infer<typeof SavedViewSchema>;

export const SavedViewCreateSchema = z.object({
  entity_type: z.string().min(1),
  name: z.string().min(1),
  config: z.record(z.unknown()).default({}),
  is_shared: z.boolean().default(false),
});
export type SavedViewCreate = z.infer<typeof SavedViewCreateSchema>;

// ---------------------------------------------------------------------------
// SearchResult
// ---------------------------------------------------------------------------
export const SearchResultGroupSchema = z.enum([
  'customer',
  'quote',
  'invoice',
  'project',
]);
export type SearchResultGroup = z.infer<typeof SearchResultGroupSchema>;

export const SearchResultItemSchema = z.object({
  entity_type: SearchResultGroupSchema,
  entity_id: UuidSchema,
  title: z.string(),
  subtitle: z.string().nullable(),
  href: z.string(),
});
export type SearchResultItem = z.infer<typeof SearchResultItemSchema>;

export const SearchResultSchema = z.object({
  query: z.string(),
  groups: z.record(SearchResultGroupSchema, z.array(SearchResultItemSchema)),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

// ---------------------------------------------------------------------------
// DashboardSummary
// ---------------------------------------------------------------------------
export const DashboardSummarySchema = z.object({
  open_invoices_count: z.number().int().nonnegative(),
  ar_balance_cents: z.union([z.number().int(), z.string().regex(/^-?\d+$/)]),
  overdue_invoices_count: z.number().int().nonnegative(),
  open_quotes_count: z.number().int().nonnegative(),
  in_flight_receiving_count: z.number().int().nonnegative(),
  in_flight_shipments_count: z.number().int().nonnegative(),
  active_projects_count: z.number().int().nonnegative(),
  currency_code: z.string().default('USD'),
  // UX-Q5: live dashboard work-card counts. Default to 0 so older clients
  // that do not yet send these fields parse cleanly against a refreshed
  // schema during deploy lag.
  quotes_awaiting_approval_count: z.number().int().nonnegative().default(0),
  runs_in_production_count: z.number().int().nonnegative().default(0),
  shipments_ready_to_ship_count: z.number().int().nonnegative().default(0),
  unpaid_invoices_count: z.number().int().nonnegative().default(0),
});
export type DashboardSummary = z.infer<typeof DashboardSummarySchema>;

// ---------------------------------------------------------------------------
// KitCostSummary (Path C / C1)
//
// Read-only KitCost pillar dashboard payload. All monetary fields are BIGINT
// cents on the wire (string to survive Number.MAX_SAFE_INTEGER at 9.0e15).
// margin_pct is a Number with one decimal place; the rest are integers.
// ---------------------------------------------------------------------------
const BigIntCentsSchema = z.union([
  z.number().int(),
  z.string().regex(/^-?\d+$/),
]);

export const KitCostSummarySchema = z.object({
  kpis: z.object({
    total_revenue_ytd_cents: BigIntCentsSchema,
    invoiced_this_month_cents: BigIntCentsSchema,
    active_projects_count: z.number().int().nonnegative(),
    inventory_value_cents: BigIntCentsSchema,
  }),
  revenue_trend: z.array(
    z.object({
      month: z.string().regex(/^\d{4}-\d{2}$/),
      revenue_cents: BigIntCentsSchema,
    }),
  ),
  top_customers: z.array(
    z.object({
      customer_id: UuidSchema,
      customer_name: z.string(),
      revenue_cents: BigIntCentsSchema,
    }),
  ),
  project_margins: z.array(
    z.object({
      project_id: UuidSchema,
      project_name: z.string(),
      revenue_cents: BigIntCentsSchema,
      cost_cents: BigIntCentsSchema,
      margin_cents: BigIntCentsSchema,
      margin_pct: z.number(),
    }),
  ),
});
export type KitCostSummary = z.infer<typeof KitCostSummarySchema>;

// ---------------------------------------------------------------------------
// ImportJob
// ---------------------------------------------------------------------------
export const ImportEntityTypeSchema = z.enum([
  'customer',
  'item',
  'vendor',
  'invoice',
  'expense',
]);
export type ImportEntityType = z.infer<typeof ImportEntityTypeSchema>;

export const ImportRowErrorSchema = z.object({
  row_number: z.number().int().positive(),
  field: z.string().nullable(),
  message: z.string(),
});
export type ImportRowError = z.infer<typeof ImportRowErrorSchema>;

export const ImportValidateRequestSchema = z.object({
  entity_type: ImportEntityTypeSchema,
  rows: z.array(z.record(z.unknown())),
});
export type ImportValidateRequest = z.infer<typeof ImportValidateRequestSchema>;

export const ImportValidateResponseSchema = z.object({
  total_rows: z.number().int().nonnegative(),
  valid_rows: z.number().int().nonnegative(),
  errors: z.array(ImportRowErrorSchema),
});
export type ImportValidateResponse = z.infer<typeof ImportValidateResponseSchema>;

export const ImportCommitRequestSchema = ImportValidateRequestSchema;
export type ImportCommitRequest = z.infer<typeof ImportCommitRequestSchema>;

export const ImportCommitResponseSchema = z.object({
  inserted: z.number().int().nonnegative(),
  errors: z.array(ImportRowErrorSchema),
});
export type ImportCommitResponse = z.infer<typeof ImportCommitResponseSchema>;

// ---------------------------------------------------------------------------
// ExportJob
// ---------------------------------------------------------------------------
export const ExportEntityTypeSchema = z.enum([
  'customer',
  'invoice',
  'payment',
  'journal_entry',
  'expense',
  'stock_movement',
  'shipment',
  'vendor_bill',
]);
export type ExportEntityType = z.infer<typeof ExportEntityTypeSchema>;

// ---------------------------------------------------------------------------
// PortalCustomerView
// ---------------------------------------------------------------------------
export const PortalCustomerViewSchema = z.object({
  customer_id: UuidSchema,
  org_id: UuidSchema,
  display_name: z.string(),
  email: z.string().email().nullable(),
});
export type PortalCustomerView = z.infer<typeof PortalCustomerViewSchema>;

export const PortalInvoiceSummarySchema = z.object({
  id: UuidSchema,
  number: z.string(),
  status: z.string(),
  issued_at: z.string().nullable(),
  due_at: z.string().nullable(),
  total_cents: z.union([z.number().int(), z.string().regex(/^-?\d+$/)]),
  balance_cents: z.union([z.number().int(), z.string().regex(/^-?\d+$/)]),
  currency_code: z.string(),
});
export type PortalInvoiceSummary = z.infer<typeof PortalInvoiceSummarySchema>;
