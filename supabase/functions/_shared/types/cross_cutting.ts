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
  'item',
  'job_run',
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
  // Setup checklist booleans. Each is true once the matching entity exists
  // for the org. setup_warehouse_added is true from day one because
  // seed_org_default_warehouse runs at provisioning (migration 0064); the
  // operator-facing copy on the SetupChecklist explains the default warehouse
  // and points to Library where it can be renamed. Defaults to false so
  // older clients that do not yet send these fields parse cleanly against a
  // refreshed schema during deploy lag.
  setup_warehouse_added: z.boolean().default(false),
  setup_customer_added: z.boolean().default(false),
  setup_item_added: z.boolean().default(false),
  setup_quote_created: z.boolean().default(false),
  setup_receiving_received: z.boolean().default(false),
  setup_invoice_sent: z.boolean().default(false),
  setup_payment_received: z.boolean().default(false),
  // True once at least one staff teammate has been invited (any active
  // org_membership beyond the provisioning org_owner). Backs the optional
  // "Invite your team" step on the Setup Checklist. Defaults to false so
  // older clients that do not yet send this field parse cleanly.
  setup_team_invited: z.boolean().default(false),
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
// SellSummary (Section Dashboards, Phase 1)
//
// Read-only Sell section dashboard payload. Monetary fields are BIGINT cents on
// the wire (string to survive Number.MAX_SAFE_INTEGER at 9.0e15). win_rate_pct
// is a Number with one decimal (0 when no opportunity has been decided yet).
// ---------------------------------------------------------------------------
export const SellSummarySchema = z.object({
  kpis: z.object({
    open_opportunities_count: z.number().int().nonnegative(),
    pipeline_value_cents: BigIntCentsSchema,
    quotes_awaiting_approval_count: z.number().int().nonnegative(),
    active_projects_count: z.number().int().nonnegative(),
    win_rate_pct: z.number(),
  }),
  currency_code: z.string().default('USD'),
  pipeline_by_stage: z.array(
    z.object({
      stage: z.string(),
      count: z.number().int().nonnegative(),
      value_cents: BigIntCentsSchema,
    }),
  ),
  quotes_needing_action: z.array(
    z.object({
      id: UuidSchema,
      number: z.string(),
      customer_name: z.string(),
      state: z.string(),
      total_cents: BigIntCentsSchema,
    }),
  ),
});
export type SellSummary = z.infer<typeof SellSummarySchema>;

// ---------------------------------------------------------------------------
// MoneySummary (Section Dashboards, Phase 1)
//
// Read-only Money section dashboard payload. All monetary fields are BIGINT
// cents on the wire (string). AR aging buckets sum the outstanding balance of
// unpaid invoices by days past their due_date.
// ---------------------------------------------------------------------------
export const MoneySummarySchema = z.object({
  kpis: z.object({
    ar_balance_cents: BigIntCentsSchema,
    unpaid_invoices_count: z.number().int().nonnegative(),
    payments_this_month_cents: BigIntCentsSchema,
    credit_notes_outstanding_cents: BigIntCentsSchema,
    credit_notes_outstanding_count: z.number().int().nonnegative(),
  }),
  currency_code: z.string().default('USD'),
  ar_aging: z.object({
    current_cents: BigIntCentsSchema,
    d1_30_cents: BigIntCentsSchema,
    d31_60_cents: BigIntCentsSchema,
    d61_90_cents: BigIntCentsSchema,
    d90_plus_cents: BigIntCentsSchema,
  }),
  unpaid_invoices: z.array(
    z.object({
      id: UuidSchema,
      number: z.string(),
      customer_name: z.string(),
      status: z.string(),
      due_date: z.string().nullable(),
      balance_cents: BigIntCentsSchema,
    }),
  ),
});
export type MoneySummary = z.infer<typeof MoneySummarySchema>;

// ---------------------------------------------------------------------------
// InventorySummary (Section Dashboards, Phase 2)
//
// Read-only Inventory section dashboard payload. Quantities are plain numbers
// (numeric columns, possibly fractional), not cents. The endpoint always
// computes the inbound/outbound and bin metrics; the SPA surfaces them per
// entitlement (3PL and WMS).
// ---------------------------------------------------------------------------
export const InventorySummarySchema = z.object({
  kpis: z.object({
    below_reorder_count: z.number().int().nonnegative(),
    stocked_skus_count: z.number().int().nonnegative(),
    inbound_receiving_count: z.number().int().nonnegative(),
    outbound_shipments_count: z.number().int().nonnegative(),
    occupied_bins_count: z.number().int().nonnegative(),
  }),
  below_reorder: z.array(
    z.object({
      item_id: UuidSchema,
      sku: z.string(),
      name: z.string(),
      on_hand: z.number(),
      reorder_point: z.number(),
    }),
  ),
  inbound_receiving: z.array(
    z.object({
      id: UuidSchema,
      number: z.string(),
      status: z.string(),
      expected_date: z.string().nullable(),
    }),
  ),
});
export type InventorySummary = z.infer<typeof InventorySummarySchema>;

// ---------------------------------------------------------------------------
// ProductionSummary (Section Dashboards, Phase 2)
//
// Read-only Production and Fulfillment section dashboard payload. KPIs span the
// manufacturing, co-pack, and 3PL add-ons; the SPA folds the per-add-on widget
// lists by entitlement. The endpoint always computes all counts (org-scoped
// reads yield zero for add-ons the org does not use).
// ---------------------------------------------------------------------------
export const ProductionSummarySchema = z.object({
  kpis: z.object({
    runs_in_production_count: z.number().int().nonnegative(),
    kitting_in_progress_count: z.number().int().nonnegative(),
    orders_to_fulfill_count: z.number().int().nonnegative(),
    late_jobs_count: z.number().int().nonnegative(),
  }),
  manufacturing_runs: z.array(
    z.object({
      id: UuidSchema,
      number: z.string(),
      status: z.string(),
      planned_complete_at: z.string().nullable(),
    }),
  ),
  sales_orders: z.array(
    z.object({
      id: UuidSchema,
      number: z.string(),
      status: z.string(),
      customer_name: z.string(),
    }),
  ),
  job_runs: z.array(
    z.object({
      id: UuidSchema,
      number: z.string(),
      status: z.string(),
    }),
  ),
});
export type ProductionSummary = z.infer<typeof ProductionSummarySchema>;

// ---------------------------------------------------------------------------
// BuySummary (Section Dashboards, Phase 3)
//
// Read-only Buy section dashboard payload. Monetary fields are BIGINT cents on
// the wire (string). Spend this month sums vendor bills and expenses dated in
// the current UTC month.
// ---------------------------------------------------------------------------
export const BuySummarySchema = z.object({
  kpis: z.object({
    open_pos_count: z.number().int().nonnegative(),
    vendor_bills_due_count: z.number().int().nonnegative(),
    vendor_bills_due_cents: BigIntCentsSchema,
    expenses_to_approve_count: z.number().int().nonnegative(),
    spend_this_month_cents: BigIntCentsSchema,
  }),
  currency_code: z.string().default('USD'),
  open_purchase_orders: z.array(
    z.object({
      id: UuidSchema,
      number: z.string(),
      status: z.string(),
      expected_date: z.string().nullable(),
      total_cents: BigIntCentsSchema,
    }),
  ),
  vendor_bills_due: z.array(
    z.object({
      id: UuidSchema,
      number: z.string(),
      status: z.string(),
      due_date: z.string().nullable(),
      balance_cents: BigIntCentsSchema,
    }),
  ),
});
export type BuySummary = z.infer<typeof BuySummarySchema>;

// ---------------------------------------------------------------------------
// WorkforceSummary (Section Dashboards, Phase 3)
//
// Read-only Workforce section dashboard payload (KitForce). Labor cost this
// month sums time entries (minutes * hourly rate) clocked in during the current
// UTC month, as BIGINT cents (string). time_entries carries no approval state,
// so the "to approve" idea from the plan is surfaced as labor cost instead.
// ---------------------------------------------------------------------------
export const WorkforceSummarySchema = z.object({
  kpis: z.object({
    active_members_count: z.number().int().nonnegative(),
    on_shift_count: z.number().int().nonnegative(),
    open_assignments_count: z.number().int().nonnegative(),
    labor_cost_this_month_cents: BigIntCentsSchema,
  }),
  open_assignments: z.array(
    z.object({
      id: UuidSchema,
      number: z.string(),
      title: z.string(),
      status: z.string(),
      member_name: z.string(),
    }),
  ),
  on_shift: z.array(
    z.object({
      id: UuidSchema,
      number: z.string(),
      member_name: z.string(),
      started_at: z.string().nullable(),
    }),
  ),
});
export type WorkforceSummary = z.infer<typeof WorkforceSummarySchema>;

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

export const ImportJobStatusSchema = z.enum([
  'pending',
  'processing',
  'completed',
  'failed',
]);
export type ImportJobStatus = z.infer<typeof ImportJobStatusSchema>;

export const ImportJobSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  entity_type: ImportEntityTypeSchema,
  status: ImportJobStatusSchema,
  total_rows: z.number().int().nonnegative(),
  valid_rows: z.number().int().nonnegative(),
  inserted_rows: z.number().int().nonnegative(),
  error_count: z.number().int().nonnegative(),
  errors: z.array(ImportRowErrorSchema),
  created_at: z.string(),
  created_by: z.string().uuid().nullable(),
  completed_at: z.string().nullable(),
});
export type ImportJob = z.infer<typeof ImportJobSchema>;

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

// ---------------------------------------------------------------------------
// DashboardPrefs (Personalization)
//
// Per-user, per-section dashboard layout, stored in user_dashboard_prefs
// (migration 0128): one row per (org, user, section_key). section_key is
// 'dashboard' (the global home) or a sidebar section home key
// ('sell','money',...). widgets maps a widget id to its visibility + order;
// pinned_views promotes a saved view to a dashboard widget. The shape is
// intentionally open: an unknown widget id is tolerated so a layout written by
// a newer build degrades gracefully on an older one.
// ---------------------------------------------------------------------------
export const DashboardWidgetPrefSchema = z.object({
  hidden: z.boolean().optional(),
  order: z.number().int().optional(),
});
export type DashboardWidgetPref = z.infer<typeof DashboardWidgetPrefSchema>;

export const DashboardPinnedViewSchema = z.object({
  saved_view_id: UuidSchema,
  order: z.number().int().optional(),
});
export type DashboardPinnedView = z.infer<typeof DashboardPinnedViewSchema>;

export const DashboardSectionLayoutSchema = z.object({
  widgets: z.record(DashboardWidgetPrefSchema).optional(),
  pinned_views: z.array(DashboardPinnedViewSchema).optional(),
});
export type DashboardSectionLayout = z.infer<typeof DashboardSectionLayoutSchema>;

// Section keys a layout may be stored against: the global dashboard plus each
// sidebar section home. Mirrors the SPA SIDEBAR_MODES home paths (sans slash).
export const DashboardSectionKeySchema = z.enum([
  'dashboard',
  'sell',
  'buy',
  'inventory',
  'production',
  'money',
  'workforce',
  'insights',
  'settings',
]);
export type DashboardSectionKey = z.infer<typeof DashboardSectionKeySchema>;

// GET /dashboard/prefs response: a map of section_key -> layout.
export const DashboardPrefsSchema = z.object({
  sections: z.record(DashboardSectionLayoutSchema),
});
export type DashboardPrefs = z.infer<typeof DashboardPrefsSchema>;

// PUT /dashboard/prefs request: replace one section's layout.
export const DashboardPrefUpdateSchema = z.object({
  section_key: DashboardSectionKeySchema,
  config: DashboardSectionLayoutSchema,
});
export type DashboardPrefUpdate = z.infer<typeof DashboardPrefUpdateSchema>;

// PUT /dashboard/prefs response: the persisted section + layout.
export const DashboardPrefSavedSchema = z.object({
  section_key: DashboardSectionKeySchema,
  config: DashboardSectionLayoutSchema,
});
export type DashboardPrefSaved = z.infer<typeof DashboardPrefSavedSchema>;
