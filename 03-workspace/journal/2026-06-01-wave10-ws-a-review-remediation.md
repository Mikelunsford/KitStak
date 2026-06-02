# WS-A review remediation. Money integrity.

Wave: 10
Phase: Review remediation
Closes: F-Wave10-REVIEW-REMEDIATION (WS-A blocking review item)
Date: 2026-06-01

## Blocking review item

The WS-A implement step output was not registered as a committed artifact by the
orchestrator ("implement step did not commit"). This entry records the
verification that the implement step did land on disk and that every relevant
gate is green, and registers a committed remediation artifact for WS-A.

## Verification

The WS-A money-integrity implementation is present in commit
6fd5e2bfd870b2597ce63e447b1a41e495d4ac53 on branch wave10-review-remediation.

Scope confirmed in that commit:

- A1. invoiceLineMath() added. Invoice line create and patch persist
  server-recomputed tax_amount_cents and line_total_cents and ignore any
  client-supplied totals. tax_rate_snapshot is a decimal fraction numeric(7,4).
  Both POST and PATCH paths drop forged totals before the insert and update.
- A2. vendors-api purchase-order lineComputed uses roundHalfEven, not Math.round.
- A3. roundHalfEven replaces Math.round on money in sourceLinePrefill,
  InvoiceDetailPage, ProjectDetailPage, and dashboard-api rollups.
- A4. False "banker's rounding via Math.round" comments corrected.
- A6. Header-grain currency snapshot documented at the invoice, quote, and PO
  line layers.

Regression coverage confirmed:

- test/regression/invoice-line-server-recompute.test.ts. Forged-total overwrite
  on create and on patch, plus zero-tax recompute.
- test/regression/po-line-half-even.test.ts. Half-even boundary math.

## Gates run

- pnpm typecheck. Pass.
- pnpm test:contract. Pass. 3 files, 26 tests, including money.parity.
- WS-A regression suites. Pass. invoice-line-server-recompute and
  po-line-half-even.

## Constitutional alignment

- Money. BIGINT cents preserved. roundHalfEven used on all monetary math. No
  float on _cents columns. money.ts itself untouched.
- Mirror canons unchanged. money.parity and types parity still green.
- No new top-level dependency. crypto.randomUUID() only.

## Outcome

WS-A is verified committed and green. No further code change required for the
blocking item. This entry is the registered remediation artifact.
