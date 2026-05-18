# Finance and invoicing user guide

Wave 2 ships the chassis for invoicing and finance. This page describes the
operator-facing flow.

## Invoicing

### Create and send an invoice

1. Open `/invoicing/invoices` and click NEW INVOICE.
2. Fill in the invoice number, currency, issue date, due date, and any notes.
3. Save the draft. The detail page opens with an empty line-item table.
4. Add line items. Tax rate is snapshotted per line; totals recompute
   automatically.
5. When ready, click SEND on the detail page. The invoice transitions from
   draft to sent. If the journal-entry feature is on for this org, a posted
   journal entry is written by the database. You will see it on the
   `/finance/journal-entries` page.

### Apply a payment

1. Create a payment from `/invoicing/payments`. Enter the amount and currency
   received.
2. Open the payment apply screen and split the payment across one or more
   sent invoices. The amounts add up to the payment total or less; the
   unapplied balance stays on the payment row.
3. Each apply automatically updates the affected invoices' paid_cents and
   balance_cents. If the finance feature is on, a Cash to Accounts Receivable
   journal entry is posted.

### Apply a credit note

1. Create a credit note from `/invoicing/credit-notes`. Set the source invoice
   if the credit is invoice-specific.
2. Open the apply screen and allocate the credit across one or more sent
   invoices. Each allocation reduces the invoice balance and, when the
   finance feature is on, posts a reversal journal entry.

## Finance

### Chart of accounts

`/finance/coa` lists the 13 default accounts seeded for every org plus any
custom accounts. System accounts cannot be deleted.

### Journal entries

`/finance/journal-entries` lists every entry for the active org. Detail view
shows debits and credits with running totals. The POST button transitions a
draft entry to posted after a balance check.

This page is hidden when the `finance.journal_entries.enabled` flag is off
for the org. Toggle the flag from the admin feature flags page.

### Period close

`/finance/period-close` lists 12 months for the selected year. CLOSE marks the
period closed; once closed, the database rejects any new posted journal entry
into that period with a `period_closed:` error. REOPEN restores write access.

Period close is admin / accounting only. The button is hidden for other
roles, and the server-side capability check rejects anyone else.

## Roles and capabilities

| Role | Invoicing | Payments | Credit notes | COA | JE | Period close |
|---|---|---|---|---|---|---|
| org_owner | full | full | full | full | full | full |
| org_admin | full | full | full | full | full | full |
| accounting | full | full | full | full | full | full |
| sales | read + write + send | read | read | read | read | read |
| ops | read | read | read | none | none | none |
| viewer | read | read | read | read | read | read |
| customer_user | none | none | none | none | none | none |
| vendor_user | none | none | none | none | none | none |
