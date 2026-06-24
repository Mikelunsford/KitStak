// Finance type canon. Byte-mirror of apps/web/src/lib/types/finance.ts.
// Schemas for invoices (9-state), invoice_line_items, invoice_versions,
// payments, payment_allocations, credit_notes (4-state), credit_note_allocations,
// chart_of_accounts, journal_entries (3-state), journal_entry_lines, and
// period_close (text CHECK 4-state, not pg enum per AUDIT.md). All money in
// BIGINT cents serialised as integer or numeric string.

import { z } from 'zod';

export const FinanceUuidSchema = z.string().uuid();
export const FinanceTimestampSchema = z.string();
export const FinanceCentsSchema = z.union([
  z.number().int(),
  z.string().regex(/^-?\d+$/),
]);

// ---------------------------------------------------------------------------
// Invoice (9-state) plus line items and versions.
// ---------------------------------------------------------------------------

export const InvoiceStatusSchema = z.enum([
  'draft',
  'pending',
  'sent',
  'partially_paid',
  'paid',
  'overdue',
  'refunded',
  'cancelled',
  'on_hold',
]);
export type InvoiceStatus = z.infer<typeof InvoiceStatusSchema>;

export const InvoiceSchema = z.object({
  id: FinanceUuidSchema,
  org_id: FinanceUuidSchema,
  invoice_number: z.string(),
  customer_id: FinanceUuidSchema.nullable(),
  project_id: FinanceUuidSchema.nullable(),
  quote_id: FinanceUuidSchema.nullable(),
  status: InvoiceStatusSchema,
  state_changed_at: FinanceTimestampSchema,
  currency_code: z.string(),
  issue_date: z.string().nullable(),
  due_date: z.string().nullable(),
  subtotal_cents: FinanceCentsSchema,
  tax_total_cents: FinanceCentsSchema,
  total_cents: FinanceCentsSchema,
  paid_cents: FinanceCentsSchema,
  credit_allocated_cents: FinanceCentsSchema,
  balance_cents: FinanceCentsSchema,
  notes: z.string().nullable(),
  pdf_url: z.string().nullable(),
  sent_at: FinanceTimestampSchema.nullable(),
  sent_to: z.string().nullable(),
  paid_at: FinanceTimestampSchema.nullable(),
  cancelled_at: FinanceTimestampSchema.nullable(),
  created_at: FinanceTimestampSchema,
  updated_at: FinanceTimestampSchema,
});
export type Invoice = z.infer<typeof InvoiceSchema>;

export const InvoiceLineItemSchema = z.object({
  id: FinanceUuidSchema,
  invoice_id: FinanceUuidSchema,
  item_id: FinanceUuidSchema.nullable(),
  description: z.string(),
  quantity: z.union([z.number(), z.string()]),
  unit_price_cents: FinanceCentsSchema,
  tax_rate_snapshot: z.union([z.number(), z.string()]),
  tax_amount_cents: FinanceCentsSchema,
  discount_cents: FinanceCentsSchema,
  line_total_cents: FinanceCentsSchema,
  sort_order: z.number().int(),
  // ADR 0005 Phase 1b: carried from the source project line on conversion.
  billing_interval: z.enum(['one_time', 'monthly']),
});
export type InvoiceLineItem = z.infer<typeof InvoiceLineItemSchema>;

export const InvoiceVersionSchema = z.object({
  id: FinanceUuidSchema,
  org_id: FinanceUuidSchema,
  invoice_id: FinanceUuidSchema,
  version_number: z.number().int(),
  snapshot_jsonb: z.record(z.unknown()),
  created_at: FinanceTimestampSchema,
});
export type InvoiceVersion = z.infer<typeof InvoiceVersionSchema>;

// ---------------------------------------------------------------------------
// Payment plus allocations.
// ---------------------------------------------------------------------------

export const PaymentSchema = z.object({
  id: FinanceUuidSchema,
  org_id: FinanceUuidSchema,
  payment_number: z.string(),
  customer_id: FinanceUuidSchema.nullable(),
  amount_cents: FinanceCentsSchema,
  currency_code: z.string(),
  payment_method: z.string().nullable(),
  reference_number: z.string().nullable(),
  received_at: FinanceTimestampSchema,
  notes: z.string().nullable(),
  unapplied_cents: FinanceCentsSchema,
  created_at: FinanceTimestampSchema,
  updated_at: FinanceTimestampSchema,
});
export type Payment = z.infer<typeof PaymentSchema>;

export const PaymentAllocationSchema = z.object({
  id: FinanceUuidSchema,
  payment_id: FinanceUuidSchema,
  invoice_id: FinanceUuidSchema,
  amount_cents: FinanceCentsSchema,
  created_at: FinanceTimestampSchema,
});
export type PaymentAllocation = z.infer<typeof PaymentAllocationSchema>;

// ---------------------------------------------------------------------------
// Credit note (4-state) plus allocations.
// ---------------------------------------------------------------------------

export const CreditNoteStatusSchema = z.enum([
  'draft',
  'issued',
  'applied',
  'voided',
]);
export type CreditNoteStatus = z.infer<typeof CreditNoteStatusSchema>;

export const CreditNoteSchema = z.object({
  id: FinanceUuidSchema,
  org_id: FinanceUuidSchema,
  credit_note_number: z.string(),
  customer_id: FinanceUuidSchema.nullable(),
  source_invoice_id: FinanceUuidSchema.nullable(),
  status: CreditNoteStatusSchema,
  state_changed_at: FinanceTimestampSchema,
  currency_code: z.string(),
  amount_cents: FinanceCentsSchema,
  applied_cents: FinanceCentsSchema,
  reason: z.string().nullable(),
  issued_at: FinanceTimestampSchema.nullable(),
  voided_at: FinanceTimestampSchema.nullable(),
  created_at: FinanceTimestampSchema,
  updated_at: FinanceTimestampSchema,
});
export type CreditNote = z.infer<typeof CreditNoteSchema>;

export const CreditNoteAllocationSchema = z.object({
  id: FinanceUuidSchema,
  credit_note_id: FinanceUuidSchema,
  invoice_id: FinanceUuidSchema,
  amount_cents: FinanceCentsSchema,
  created_at: FinanceTimestampSchema,
});
export type CreditNoteAllocation = z.infer<typeof CreditNoteAllocationSchema>;

// ---------------------------------------------------------------------------
// Chart of accounts.
// ---------------------------------------------------------------------------

export const AccountTypeSchema = z.enum([
  'asset',
  'liability',
  'equity',
  'revenue',
  'expense',
]);
export type AccountType = z.infer<typeof AccountTypeSchema>;

export const ChartOfAccountSchema = z.object({
  id: FinanceUuidSchema,
  org_id: FinanceUuidSchema,
  code: z.string(),
  name: z.string(),
  account_type: AccountTypeSchema,
  parent_account_id: FinanceUuidSchema.nullable(),
  is_active: z.boolean(),
  is_system: z.boolean(),
  description: z.string().nullable(),
  created_at: FinanceTimestampSchema,
  updated_at: FinanceTimestampSchema,
});
export type ChartOfAccount = z.infer<typeof ChartOfAccountSchema>;

// ---------------------------------------------------------------------------
// Journal entry (3-state) plus lines.
// ---------------------------------------------------------------------------

export const JournalEntryStatusSchema = z.enum([
  'draft',
  'posted',
  'reversed',
]);
export type JournalEntryStatus = z.infer<typeof JournalEntryStatusSchema>;

export const JournalEntrySourceTypeSchema = z.enum([
  'invoice',
  'payment',
  'expense',
  'credit_note',
  'vendor_bill',
  'vendor_bill_payment',
  'manual',
]);
export type JournalEntrySourceType = z.infer<typeof JournalEntrySourceTypeSchema>;

export const JournalEntrySchema = z.object({
  id: FinanceUuidSchema,
  org_id: FinanceUuidSchema,
  entry_number: z.string(),
  entry_date: z.string(),
  period_year: z.number().int(),
  period_month: z.number().int().min(1).max(12),
  status: JournalEntryStatusSchema,
  state_changed_at: FinanceTimestampSchema,
  source_type: JournalEntrySourceTypeSchema,
  source_id: FinanceUuidSchema.nullable(),
  memo: z.string().nullable(),
  posted_at: FinanceTimestampSchema.nullable(),
  reversed_at: FinanceTimestampSchema.nullable(),
  reversal_of_id: FinanceUuidSchema.nullable(),
  created_at: FinanceTimestampSchema,
  updated_at: FinanceTimestampSchema,
});
export type JournalEntry = z.infer<typeof JournalEntrySchema>;

export const JournalEntryLineSchema = z.object({
  id: FinanceUuidSchema,
  entry_id: FinanceUuidSchema,
  account_id: FinanceUuidSchema,
  debit_cents: FinanceCentsSchema,
  credit_cents: FinanceCentsSchema,
  memo: z.string().nullable(),
  sort_order: z.number().int(),
  created_at: FinanceTimestampSchema,
});
export type JournalEntryLine = z.infer<typeof JournalEntryLineSchema>;

// ---------------------------------------------------------------------------
// Period close. Text CHECK 4-state. AUDIT.md row 65 overrides TS1's pg enum.
// ---------------------------------------------------------------------------

export const PeriodCloseStatusSchema = z.enum([
  'open',
  'in_review',
  'closed',
  'reopened',
]);
export type PeriodCloseStatus = z.infer<typeof PeriodCloseStatusSchema>;

export const PeriodCloseSchema = z.object({
  id: FinanceUuidSchema,
  org_id: FinanceUuidSchema,
  period_year: z.number().int(),
  period_month: z.number().int().min(1).max(12),
  status: PeriodCloseStatusSchema,
  state_changed_at: FinanceTimestampSchema,
  closed_at: FinanceTimestampSchema.nullable(),
  closed_by: FinanceUuidSchema.nullable(),
  reopened_at: FinanceTimestampSchema.nullable(),
  reopened_by: FinanceUuidSchema.nullable(),
  notes: z.string().nullable(),
  created_at: FinanceTimestampSchema,
  updated_at: FinanceTimestampSchema,
});
export type PeriodClose = z.infer<typeof PeriodCloseSchema>;

// ---------------------------------------------------------------------------
// Recurring schedule (ADR 0005 Phase 2). One monthly billing schedule per
// project, created by migration 0138. The pg_cron generator drafts an invoice
// from the project's monthly lines on next_run_on, then advances next_run_on
// one month. The schedule-CRUD edge endpoint (invoicing-api) creates / pauses /
// resumes / ends / lists schedules; it gates on the invoicing read/write caps
// and the table carries Pattern A RLS on org_id. created_by / updated_by /
// metadata are intentionally omitted from the wire shape.
// ---------------------------------------------------------------------------

export const RecurringScheduleStatusSchema = z.enum([
  'active',
  'paused',
  'ended',
]);
export type RecurringScheduleStatus = z.infer<typeof RecurringScheduleStatusSchema>;

export const RecurringScheduleCadenceSchema = z.enum(['monthly']);
export type RecurringScheduleCadence = z.infer<
  typeof RecurringScheduleCadenceSchema
>;

export const RecurringScheduleSchema = z.object({
  id: FinanceUuidSchema,
  org_id: FinanceUuidSchema,
  project_id: FinanceUuidSchema,
  cadence: RecurringScheduleCadenceSchema,
  next_run_on: z.string(),
  status: RecurringScheduleStatusSchema,
  last_run_on: z.string().nullable(),
  last_invoice_id: FinanceUuidSchema.nullable(),
  created_at: FinanceTimestampSchema,
  updated_at: FinanceTimestampSchema,
});
export type RecurringSchedule = z.infer<typeof RecurringScheduleSchema>;

// Create request. The handler mints org_id from the caller, defaults cadence to
// monthly and next_run_on to today when absent, and stamps status active.
export const CreateRecurringScheduleRequestSchema = z.object({
  project_id: FinanceUuidSchema,
  next_run_on: z.string().optional(),
  cadence: RecurringScheduleCadenceSchema.optional(),
});
export type CreateRecurringScheduleRequest = z.infer<
  typeof CreateRecurringScheduleRequestSchema
>;
