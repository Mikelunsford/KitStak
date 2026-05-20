# Phase 8 follow-up: pdf-worker real-render via jsPDF (F-Wave2-CO-01)

Closeout journal for the long-standing operator-gated carryover that has been on the books since the Wave 2 close. The operator approved `jsPDF` as the rendering dependency (Apache-2.0 / MIT-permissive, browser plus Node plus Deno compatible) and authorised this PR to ship.

## Motivation

The quote-to-cash flow walked end-to-end at the Phase 6 gate ends with a sent invoice and a posted payment, but the operator could not hand the customer a PDF of that invoice. Pre this PR, the pdf-worker bundle's POST `/pdf/render` returned `501 PDF_NOT_YET_AVAILABLE` because the constitution refuses to ship an unapproved top-level dep, and the prior agent on this work had no operator-approved JS PDF library to land. F-Wave2-CO-01 closes that gap.

## Architecture decision: data URL, not Storage bucket

The pre-existing SPA service at `apps/web/src/lib/services/pdfService.ts` was already shaped to return `{ url: string }` to the consumer. That shape is satisfied two ways:

1. **Data URL** (`data:application/pdf;base64,...`). The worker renders the PDF, base64-encodes the bytes, and returns the encoded string as the URL. The SPA uses the URL directly as the `href` on a hidden `<a download>` anchor; the browser handles the download. No server-side state.
2. **Signed URL into a Storage bucket.** The worker writes the PDF bytes to a Supabase Storage bucket and returns a signed URL. Requires a bucket strategy decision (one bucket per org? org-prefixed keys in a shared bucket?), a retention policy, a CDN posture, and a cleanup pass to delete expired blobs.

Option 1 ships now. Option 2 is filed as the operator-gated `F-Wave8-PDF-STORAGE-BUCKET-01` for the case where the operator eventually wants "send this PDF as a link to the customer" rather than "download this PDF to my laptop and email it myself." The data URL approach completely covers the latter, which is the operator's daily-path use case.

The blast-radius difference is real. Option 1 adds one dependency and one feature path. Option 2 adds one dependency, one bucket policy, one cleanup cron, one signed-URL secret, and a CDN integration. We default to the smallest surface that closes the operator workflow gap.

## v1 scope

- **Three template renderers ship.** `invoice`, `quote`, `purchase_order`. Each template carries its own zod schema in a discriminated union on the request body so the API boundary asserts the shape per template (no `z.record(z.unknown())` slop).
- **Only the invoice download is wired in the SPA this round.** Invoice is the operator's daily path. `InvoiceDetailPage` gets a "Download PDF" button, cap-gated on `pdf.document.render`. Quote and PO download buttons are filed as `F-Wave8-PDF-QUOTE-DOWNLOAD-01` and `F-Wave8-PDF-PO-DOWNLOAD-01`, both mechanical pastes from the invoice path once the invoice flow soaks for one operator pass.
- **Pagination caps at 10 pages.** Lines flow page-to-page with a fresh header band on each continuation page. Lines that would push past page 10 are dropped silently; v1 callers do not have invoices that long.

## Brand application

The rendered PDF uses the Kitstak palette tokens from `tailwind.config.js`:

- Header band: navy `#0a1628` background, ink `#f5f1e8` display text. "KITSTAK" left, document type label right ("INVOICE" / "QUOTE" / "PURCHASE ORDER").
- Body text: dark ink on white, helvetica.
- Section labels: ink-dim grey, small uppercase.
- Footer: "Built to Ship." tagline left, page-number right.

Custom-font embedding (Bebas Neue display, Inter Tight body, JetBrains Mono mono) is **not** in v1. jsPDF supports font embedding via `doc.addFileToVFS` + `doc.addFont`, but it adds binary font assets to the worker bundle and requires a content-negotiation pass to confirm the font licences allow PDF embedding. Filed as `F-Wave8-PDF-FONT-EMBED-01`. v1 ships with the jsPDF built-in helvetica family, which is acceptable brand-wise for a v1 download.

No em dashes, no double hyphens, no emojis in the rendered body text. All separators are periods or the middle-dot. The Recipient block uses two-column "LABEL: value" layout, not narrative prose with dashes.

## Money handling

The renderer takes cents as a number or string (the wire shape from PostgREST for BIGINT columns), normalises to a number via `asCents`, and renders via `formatCents(cents, currency)` from `_shared/money.ts`. No floating-point math is introduced anywhere; the cents value flows from the SPA caller (where it comes off the loaded invoice row, which itself originates as BIGINT cents in Postgres) to the renderer without ever being divided. `formatCents` is the only conversion point and it uses `Intl.NumberFormat` with `style: 'currency'` and the snapshotted currency code from the invoice.

## Base64 encoding posture

The worker uses a chunked `btoa(String.fromCharCode.apply(null, slice))` loop with 32kB chunks rather than `Deno.std/encoding/base64` or Node's `Buffer.toString('base64')`. Three reasons:

1. **Runtime-independent.** The same code path runs under Deno (production), Node (Vitest harness), and the browser. No Deno std-lib URL imports to add to the import map; no Node Buffer to shim away in the test environment.
2. **Call-stack safe.** A naive `btoa(String.fromCharCode(...new Uint8Array(buf)))` blows the JS call stack at ~100kB. Chunked encoding scales to arbitrary PDF sizes.
3. **Zero dependencies added.** Keeps the worker bundle's import surface tight (just jsPDF plus zod).

## Test posture

The regression test at `apps/web/test/regression/pdf-worker-render.test.ts` asserts three things:

1. POST `/pdf/render` returns 200 (no longer 501).
2. The response body's `data.url` matches `/^data:application\/pdf;base64,/`.
3. The first 5 bytes of the decoded base64 are `%PDF-` (PDF magic).

We deliberately do not snapshot the PDF body bytes. jsPDF embeds a `/CreationDate` in every PDF, and font-metric tweaks in future jsPDF versions will rewrite the entire byte stream. The magic-byte check is sufficient to prove a real PDF was produced; the visual fidelity is verified by the operator on the Download PDF button on `InvoiceDetailPage`.

A second test asserts that a malformed payload (missing required fields) returns 422 `VALIDATION_ERROR` from the discriminated-union schema, which exercises the schema-tightening half of the PR.

## Gates verified

- `pnpm typecheck`: zero errors.
- `pnpm lint`: zero errors, zero warnings.
- `pnpm test`: 21 passed, 2 skipped (6 of 6 files, including the new pdf-worker file).
- `pnpm test:contract`: 26 of 26.
- `pnpm build`: clean.
- `pnpm bundle-budget`: 29.75 kB / 40 kB (+0.02 kB from 29.73 baseline; the InvoiceDetailPage page chunk carries the new button + handler).
- `node scripts/canon-steward-check.mjs`: exit 0.
- `node scripts/trigger-audit-check.mjs`: exit 0.

**Critical bundle check**: `jspdf` is imported by the worker only. No `jspdf-*.js` chunk appears in `apps/web/dist/assets/`; the only PDF-related SPA chunk is the tiny `pdfService-*.js` (the existing API wrapper). The SPA bundle does not carry the rendering library.

## Follow-ups filed

- `F-Wave8-PDF-QUOTE-DOWNLOAD-01` — wire the Download PDF button on `QuoteDetailPage`. Mechanical paste from `InvoiceDetailPage`'s pattern.
- `F-Wave8-PDF-PO-DOWNLOAD-01` — wire the Download PDF button on `PurchaseOrderDetailPage`. Mechanical paste.
- `F-Wave8-PDF-FONT-EMBED-01` — embed Bebas Neue and Inter Tight in the PDF via `doc.addFileToVFS` + `doc.addFont`. Brand polish; not constitutionally required.
- `F-Wave8-PDF-STORAGE-BUCKET-01` — optional, operator-gated. For a "send shareable PDF link" workflow rather than the current operator-downloads-locally workflow. Requires a bucket strategy decision before it can be picked up.

## What this does NOT do

- Does not add a Supabase Storage bucket.
- Does not embed custom fonts.
- Does not generate Quote or PO downloads in the SPA (renderers ready, consumer wiring deferred to soak).
- Does not change the SPA service signature (`renderPdf` returns the same `{ url } | { not_available }` union; the `not_available` branch is now unreachable but the type-level escape hatch is preserved).
- Does not add idempotency to the POST. PDF rendering is read-shaped (no DB writes); the constitutional idempotency rule applies to handlers that mutate state.
