# Cross-cutting API

Wave 2 cross-cutting surfaces shipped by Agent F. All routes share the
canonical envelope (`{ data, meta? }` for success, `{ error }` for failure)
and require an `Idempotency-Key: <uuid v4>` header on POST/PATCH/DELETE.

## Bundles

| Bundle | Auth | Purpose |
| --- | --- | --- |
| collaboration-api | JWT | Attachments, comments, notifications, saved views |
| search-api | JWT | Global search across customers, quotes, invoices, projects |
| customer-portal-api | JWT (`customer_user` only) | Customer-facing portal data |
| dashboard-api | JWT | KPI summary for the internal dashboard |
| exports-api | JWT | CSV exports per entity |
| imports-api | JWT | Validate-then-commit CSV import |
| notifications-worker | `X-Worker-Secret` | Drain undelivered notifications |
| pdf-worker | JWT | PDF rendering (v1 returns 501) |

## collaboration-api

### Attachments
- `GET /attachments?entity_type=&entity_id=`
- `POST /attachments` body `{ entity_type, entity_id, storage_path, file_name, content_type?, size_bytes }`
- `DELETE /attachments/:id`

Storage path lives in the `attachments` bucket. Cap `attachments.attachment.create` required for POST.

### Comments
- `GET /comments?entity_type=&entity_id=`
- `POST /comments` body `{ entity_type, entity_id, body, parent_id?, is_internal? }`
- `DELETE /comments/:id`

### Notifications
- `GET /notifications`
- `POST /notifications/:id/read`

### Saved views
- `GET /saved-views?entity_type=`
- `POST /saved-views` body `{ entity_type, name, config, is_shared? }`
- `DELETE /saved-views/:id`

## search-api

- `GET /search?q=<text>` returns `{ query, groups: { customer?, quote?, invoice?, project? } }`. Up to ten results per group. ILIKE-only in v1; tsvector + GIN is a follow-up.

## customer-portal-api

All routes 404 when the caller is not `customer_user`. Otherwise the handler resolves `customer_id` from `org_memberships` and filters every query by `org_id AND customer_id`.

- `GET /portal/me`
- `GET /portal/invoices`
- `GET /portal/quotes`
- `GET /portal/projects`
- `GET /portal/attachments?entity_type=&entity_id=` (parent entity must belong to the caller's customer; else 404)

## dashboard-api

- `GET /dashboard/summary` -> `DashboardSummary` (open_invoices_count, ar_balance_cents, in-flight counters, currency).

## exports-api

- `GET /exports/<entity>?format=csv` -> CSV stream. Allowed entities: customer, invoice, payment, journal_entry, expense, stock_movement, shipment, vendor_bill. Currency in integer cents.

## imports-api

Sync-only at v1.

- `POST /imports/<entity>/validate` -> `{ total_rows, valid_rows, errors: [{ row_number, field, message }] }`
- `POST /imports/<entity>/commit` -> `{ inserted, errors }`

Allowed entities: customer, item, vendor, invoice, expense.

## notifications-worker

- `POST /drain` (requires `X-Worker-Secret`) -> `{ polled, delivered, failed }`. Pulls up to 200 undelivered notifications per call.

## pdf-worker

- `GET /pdf/templates` -> available templates (invoice, quote, purchase_order).
- `POST /pdf/render` -> v1 returns `501 PDF_NOT_YET_AVAILABLE`. Engine selection pending operator approval.

## Audit log

- `audit_log` is read via the supabase client (RLS-enforced) by the SPA `AuditTimeline` and `auditService.listAuditEntries`. The cross-cutting capability `audit_log.entry.read` gates UI visibility; row visibility is governed by Pattern A RLS on the table.
- Migration 0036 extends the `audit_log.entity_type` CHECK constraint to enumerate every entity with a state machine plus the collab tables.

## State-machine coverage

The 14 Phase 2 state machines each ship their auto-state-transition trigger from the migration that creates the table:

| Entity | Trigger | Author |
| --- | --- | --- |
| organizations.status | audit_organizations_status | Wave 1 (Agent A in 0002) |
| leads.status | audit_leads_status | Agent B |
| opportunities.stage | audit_opportunities_stage | Agent B |
| quotes.status | audit_quotes_status | Agent C |
| projects.status | audit_projects_status | Agent C |
| project_phases.status | audit_project_phases_status | Agent C |
| invoices.status | audit_invoices_status | Agent D |
| credit_notes.status | audit_credit_notes_status | Agent D |
| journal_entries.status | audit_journal_entries_status | Agent D |
| purchase_orders.status | audit_purchase_orders_status | Agent E |
| vendor_bills.status | audit_vendor_bills_status | Agent E |
| expenses.status | audit_expenses_status | Agent E |
| receiving_orders.status | audit_receiving_orders_status | Agent E |
| production_runs.status | audit_production_runs_status | Agent E |
| shipments.status | audit_shipments_status | Agent E |

Migration 0037 ships a verifier function `audit_trigger_coverage_gaps()` that returns one row per state-machine table missing its trigger. A non-empty result is a release blocker.
