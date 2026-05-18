# Finance + Invoicing API

Wave 2 contract. Two edge function bundles:

- `invoicing-api` covers invoices, invoice line items, payments, credit notes.
- `finance-api` covers chart of accounts, journal entries, and period close.

All money is BIGINT cents serialised as integer or numeric string. Currency is
snapshotted on the document header (`currency_code`). Tax rate is snapshotted
per line item (`tax_rate_snapshot`).

## Auth and gating

- Every non-GET handler enforces an `Idempotency-Key` header (UUID v4) and a
  per-route capability check via `requireFinanceCap()`.
- `finance-api` journal-entry routes additionally gate on the per-org
  feature flag `finance.journal_entries.enabled`. Flag-off returns
  `403 FEATURE_DISABLED { flag }` so the SPA can route to
  `/feature-unavailable`.
- Period-close enforcement is at the trigger layer: `tg_je_reject_closed_period`
  raises `SQLSTATE P0001` with a message prefix `period_closed:` whenever a
  posted journal entry would write into a closed period. The API handler
  catches the message prefix and maps it to a `422 VALIDATION_ERROR` envelope.

## Invoicing

### Invoice state machine (9 states, text CHECK)

`draft → pending → sent → partially_paid / paid / overdue → refunded / cancelled / on_hold`

| Method | Path | Capability |
|---|---|---|
| GET | `/invoices` | `invoices.read` |
| POST | `/invoices` | `invoices.write` |
| GET | `/invoices/:id` | `invoices.read` |
| PATCH | `/invoices/:id` | `invoices.write` |
| DELETE | `/invoices/:id` (soft) | `invoices.delete` |
| POST | `/invoices/:id/send` | `invoices.send` |
| POST | `/invoices/:id/cancel` | `invoices.cancel` |
| POST | `/invoices/:id/transition` body `{ to }` | `invoices.transition` |
| GET | `/invoices/:id/pdf` (501 stub) | `invoices.read` |

`invoices.balance_cents` is GENERATED ALWAYS AS
`(total_cents - paid_cents - credit_allocated_cents) STORED`, matching
`vendor_bills.balance_cents` to close the AUDIT.md asymmetry note.

### Invoice line items (Pattern B)

| Method | Path | Capability |
|---|---|---|
| GET | `/invoices/:id/line-items` | `invoices.read` |
| POST | `/invoices/:id/line-items` | `invoices.write` |
| PATCH | `/invoice-line-items/:line_id` | `invoices.write` |
| DELETE | `/invoice-line-items/:line_id` | `invoices.write` |

Every mutation triggers `recompute_invoice_totals(p_invoice_id)` so header
totals stay in sync.

### Payments + allocations

| Method | Path | Capability |
|---|---|---|
| GET | `/payments` | `payments.read` |
| POST | `/payments` | `payments.write` |
| GET | `/payments/:id` | `payments.read` |
| PATCH | `/payments/:id` | `payments.write` |
| DELETE | `/payments/:id` (soft) | `payments.delete` |
| POST | `/payments/:id/apply` body `{ allocations: [{ invoice_id, amount_cents }] }` | `payments.apply` |

Apply inserts `payment_allocations` rows; an AFTER trigger keeps
`payments.unapplied_cents` and `invoices.paid_cents` in sync.

### Credit notes (4 states, text CHECK)

`draft → issued → applied / voided`

| Method | Path | Capability |
|---|---|---|
| GET | `/credit-notes` | `credit_notes.read` |
| POST | `/credit-notes` | `credit_notes.write` |
| GET | `/credit-notes/:id` | `credit_notes.read` |
| PATCH | `/credit-notes/:id` | `credit_notes.write` |
| DELETE | `/credit-notes/:id` (soft) | `credit_notes.delete` |
| POST | `/credit-notes/:id/apply` | `credit_notes.apply` |

Each allocation row produces an auto-JE (see below).

## Finance

### Chart of accounts

Seeded with 13 default rows via `seed_org_chart_of_accounts(p_org_id)`.

| Method | Path | Capability |
|---|---|---|
| GET | `/coa` | `coa.read` |
| POST | `/coa` | `coa.write` |
| GET | `/coa/:id` | `coa.read` |
| PATCH | `/coa/:id` | `coa.write` |
| DELETE | `/coa/:id` (denied for `is_system`) | `coa.delete` |

### Journal entries (3 states, text CHECK)

`draft → posted → reversed`

| Method | Path | Capability |
|---|---|---|
| GET | `/journal-entries` | `journal_entries.read` |
| POST | `/journal-entries` body `{ entry, lines[] }` | `journal_entries.write` |
| GET | `/journal-entries/:id` | `journal_entries.read` |
| PATCH | `/journal-entries/:id` (draft only) | `journal_entries.write` |
| DELETE | `/journal-entries/:id` (draft only) | `journal_entries.delete` |
| POST | `/journal-entries/:id/post` | `journal_entries.post` |

All routes gated by `finance.journal_entries.enabled`. The post route calls
the `post_journal_entry` RPC which calls `check_journal_balance` and flips
status to `posted`. Periods are enforced by `tg_je_reject_closed_period`.

### Period close (4 states, text CHECK; not pg enum)

`open → in_review → closed → reopened → closed`

| Method | Path | Capability |
|---|---|---|
| GET | `/period-close[?year=YYYY]` | `period_close.read` |
| POST | `/period-close/close` body `{ period_year, period_month }` | `period_close.close` |
| POST | `/period-close/reopen` body `{ period_year, period_month }` | `period_close.reopen` |

## Auto-JE triggers (DB only)

All triggers gated by `finance.journal_entries.enabled` (per-org feature flag)
plus an `EXISTS source_type+source_id+status='posted'` idempotency guard.

| Trigger | Source | Debit | Credit |
|---|---|---|---|
| `invoices_je_on_send` | invoice → sent | 1200 Accounts Receivable | 4000 Sales Revenue |
| `payments_je_on_create` | payment INSERT | 1000 Cash | 1200 Accounts Receivable |
| `credit_note_allocations_je` | credit_note_allocations INSERT | 4000 Sales Revenue | 1200 Accounts Receivable |

Audit log writers (per AUDIT.md row 63):

- `tg_invoice_audit_state_change`
- `tg_credit_note_audit_state_change`
- `tg_je_audit_state_change`

All share the per-org hash-chain helper `kitstak_audit_state` defined in
migration 0024.

## Error shapes

| HTTP | Code | Trigger |
|---|---|---|
| 401 | `UNAUTHORIZED` / `NO_ACTIVE_ORG` | Missing or invalid JWT |
| 403 | `FORBIDDEN` | requireCap denied |
| 403 | `FEATURE_DISABLED` | per-route flag-off; payload includes `details.flag` |
| 404 | `NOT_FOUND` | Entity missing or RLS hidden |
| 409 | `STATE_CONFLICT` | Illegal FSM transition / non-draft mutate |
| 409 | `IDEMPOTENCY_CONFLICT` | Same key, different body |
| 422 | `VALIDATION_ERROR` | Body fails Zod, or `period_closed:` trigger fired |
