# Phase 8 PDF polish bundle

Date: 2026-05-20
Baseline: `e07f2ce` (PR #59 close)
Branch: `phase-8/pdf/polish-bundle`

## Scope

Three Phase 8 follow-ups closed in a single PR:

1. **F-Wave8-PDF-FONT-EMBED-01**: embed Bebas Neue (display) and Inter Tight (body) into the pdf-worker so rendered PDFs match the brand. Replaces the v1 jsPDF built-in helvetica that shipped with F-Wave2-CO-01.
2. **F-Wave8-PDF-QUOTE-DOWNLOAD-01**: wire the `Download PDF` button on `QuoteDetailPage` using the established `InvoiceDetailPage` pattern.
3. **F-Wave8-PDF-PO-DOWNLOAD-01**: same for `PurchaseOrderDetailPage`.

All three were carried out of the F-Wave2-CO-01 close (jsPDF real renderer) where the v1 ship deliberately deferred font embedding and the non-invoice download buttons until the invoice flow soaked.

## Font embedding mechanism

jsPDF supports custom-font embedding via two calls per font:

```ts
doc.addFileToVFS('FontName.ttf', base64);
doc.addFont('FontName.ttf', 'FontName', 'normal');
```

Once registered, `doc.setFont('FontName', 'normal')` selects the font for subsequent `doc.text` calls. jsPDF subsets the font on output so the embedded font payload tracks the glyphs actually used, not the entire .ttf.

### File layout

- `supabase/functions/pdf-worker/fonts/BebasNeue.ttf` (56 KB), sourced from the Google Fonts CDN URL exposed by `https://fonts.googleapis.com/css2?family=Bebas+Neue` at v16.
- `supabase/functions/pdf-worker/fonts/InterTight.ttf` (298 KB), same approach, sourced at v9.
- `supabase/functions/pdf-worker/fonts/LICENSE.txt`, the combined SIL Open Font License 1.1 text for both fonts. Bebas Neue: Copyright (c) 2010 Dharma Type. Inter Tight: Copyright 2022 The Inter Project Authors.
- `supabase/functions/pdf-worker/fonts.ts`, the generated module exporting `BEBAS_NEUE_BASE64` and `INTER_TIGHT_BASE64` as string literals. 474 KB on disk (354 KB raw font bytes + base64 overhead).
- `scripts/encode-fonts.mjs`, a Node 20+ ESM script with zero top-level dependencies. Reads the two .ttf files, emits the generated `fonts.ts`. Re-run with `node scripts/encode-fonts.mjs` whenever a font is replaced.

### License posture

Both fonts ship under SIL Open Font License 1.1. The OFL explicitly permits bundling and embedding into applications and documents, including commercial use. The license text is committed alongside the font binaries so the attribution chain is intact for anyone reading the worker source. No font modification (subsetting at jsPDF output time is permitted under the OFL).

### Why bundle base64 instead of reading the .ttf at runtime

The pdf-worker has a Vitest harness (`apps/web/test/regression/pdf-worker-render.test.ts`) that runs through a Deno shim. The shim does not provide `Deno.readFile`, and using `fetch` against a file:// URL is not portable between the Vitest harness and the deployed Edge Function. Encoding the fonts as base64 string constants at build time makes the runtime byte-identical between the two environments and avoids any I/O at render time.

The generated module is committed alongside the .ttf files because regenerating it requires Node and a writable filesystem; CI does not run the script.

### Wiring

- `applyBrandFonts(doc)` helper called at the top of each `renderInvoice` / `renderQuote` / `renderPurchaseOrder`.
- Every `setFont('helvetica', ...)` call in the renderer replaced. Display font (`BebasNeue`) for the KITSTAK wordmark, document type label, section labels (`DESCRIPTION` / `QTY` / `UNIT` / `LINE TOTAL`), recipient block field labels (`BILL TO` / `QUOTE` / `ISSUE DATE` / etc.), and the `Total` row. Body font (`InterTight`) for the customer / vendor display name, line item rows, footer (`Built to Ship.`), and `Subtotal` / `Tax` rows.
- Bebas Neue has no bold weight at OFL terms in the Google Fonts release, so the previous `helvetica bold` calls map to `BebasNeue normal` at a slightly larger size to preserve the emphasis read (header band now 28pt / 20pt instead of 24pt / 18pt; TOTAL row now 14pt instead of 13pt).

## Bundle delta

- **Worker:** `fonts.ts` adds 474 KB to the deployed function bundle. Supabase Edge Functions have a 50 MB deploy limit; the pdf-worker bundle including jsPDF (~600 KB) and the fonts comfortably stays under that.
- **SPA:** zero delta from font embedding (the SPA never imports `fonts.ts`). The new download handlers on `QuoteDetailPage` and `PODetailPage` add ~20 lines each; the post-build measurements:
  - `dist/assets/QuoteDetailPage-<hash>.js` 7.65 kB / 2.74 kB gzipped (was ~6.5 kB before; +1.1 kB raw, +0.4 kB gzipped, all in the cap-gated chunk).
  - `dist/assets/PODetailPage-<hash>.js` 5.21 kB / 1.81 kB gzipped (was ~3.8 kB before; +1.4 kB raw, +0.5 kB gzipped).
  - Main SPA index chunk **29.94 kB / 40 kB** gzipped (unchanged from baseline; the handlers live in route-split chunks, not the main bundle).

## SPA wiring detail

Both pages mirror `InvoiceDetailPage.tsx`'s pattern:

- `useMe({ enabled: true })` resolves the active role; `hasCap(role, 'pdf.document.render')` from `@/lib/capabilities` gates the button.
- `useState` pair (`pdfPending`, `pdfError`) for inline status / error rendering.
- `renderPdf('quote' | 'purchase_order', payload)` from `@/lib/services/pdfService`. The service signature is unchanged; this PR does not touch `pdfService.ts`.
- Download anchor pattern: create `a`, set `href = result.url`, set `download = 'quote-<number>.pdf'` (or `po-<number>.pdf`), append, click, remove.
- Inline error renderer below the action row in both pages so an operator sees the failure mode without opening dev tools.

Two payload nuances vs the invoice flow:

- **Quote:** the schema stores quantity as `quantity_e3` (thousandths). The worker's `LineItemSchema.quantity` is `number | string` and is rendered as-is, so the handler decimal-formats `quantity_e3 / 1000` to three decimal places before sending. `issue_date` falls back to `submitted_at ?? sent_at ?? ''` because the quote schema does not carry a dedicated `issue_date` column.
- **PO:** `useVendor(po.vendor_id)` resolves the vendor's `display_name`; the payload falls back to the vendor UUID if the vendor query is still loading so the download still works on the cold-render path. `po_number` falls back to `id.slice(0, 8)` for unnumbered draft POs.

## Test posture

`apps/web/test/regression/pdf-worker-render.test.ts` grows from 2 tests to 3:

1. (unchanged) 200 status, data-URL prefix, `%PDF-` magic bytes for the minimal invoice render.
2. (new) Decode the full PDF byte stream; assert both `BebasNeue` and `InterTight` substrings appear in the binary; assert total size stays under 2 MB. The substring check is sufficient because jsPDF writes the font name as a PostScript-style identifier in the embedded font descriptor.
3. (unchanged) 422 for a payload missing required fields.

No snapshot of the binary body is taken (jsPDF embeds a `/CreationDate` and any font-metric tweak in jsPDF would rewrite the entire byte stream).

## Operator next step

Walk a quote and PO end-to-end, click `Download PDF` on each, and confirm the rendered PDFs read with Bebas Neue at the header band and Inter Tight in the body. The invoice flow has already soaked since F-Wave2-CO-01; this PR brings the other two document types up to parity.

## Gates verified

- `pnpm typecheck`: zero errors.
- `pnpm lint`: zero errors, zero warnings.
- `pnpm test`: 22 tests pass, 2 skipped (unchanged from baseline). The extended pdf-worker test now runs three assertions in ~900ms.
- `pnpm test:contract`: 20 tests pass (17 parity + 3 money parity). No canon files touched.
- `pnpm build`: clean.
- `pnpm bundle-budget`: main SPA chunk **29.94 kB / 40 kB** gzipped.
- `node scripts/canon-steward-check.mjs`: exit 0.
- `node scripts/trigger-audit-check.mjs`: exit 0.

## Follow-ups

None expected. The Bebas Neue / Inter Tight pairing covers the constitutional brand-font requirement for the rendered PDFs. If a future template requires bold or italic body text, embed the matching weight .ttf, re-run `scripts/encode-fonts.mjs`, and call `addFont` with the bold style tag.

`F-Wave8-PDF-STORAGE-BUCKET-01` (the optional share-link flow over a Supabase Storage bucket) stays open as before; the data-URL approach shipped in F-Wave2-CO-01 still covers the operator-download case for all three document types.
