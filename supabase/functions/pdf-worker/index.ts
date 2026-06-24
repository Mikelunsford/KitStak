// pdf-worker: PDF rendering for invoice, quote, purchase_order documents.
//
//   POST /pdf/render    body { template, data } -> 200 { url: 'data:application/pdf;base64,...' }
//   GET  /pdf/templates                          -> list of available templates
//
// F-Wave2-CO-01 closed the v1 stub. The operator approved jsPDF as the
// rendering dependency (Apache-2.0 / MIT permissive, browser plus Node plus
// Deno compatible). The handler returns the rendered PDF as a data URL so
// the SPA can use it directly as the href on a download anchor; no Supabase
// Storage bucket is involved.
//
// Brand discipline applied: navy header band, ink-on-navy display text,
// Bebas Neue for display text and Inter Tight for body text (embedded via
// jsPDF addFileToVFS + addFont; both fonts ship under SIL Open Font License
// 1.1, see fonts/LICENSE.txt). No em dashes, no double hyphens, no emojis
// inside the rendered body text either.
//
// Closes: F-Wave8-PDF-FONT-EMBED-01.

import { route, type Route } from '../_shared/route.ts';
import {
  parseBody,
  requireCap,
  respondWithIdempotency,
} from '../_shared/handler-helpers.ts';
import { ApiError, ok } from '../_shared/responses.ts';
import { requireCaller } from '../_shared/tenant.ts';
import { formatCents } from '../_shared/money.ts';
import { jsPDF } from 'jspdf';
import { z } from 'zod';
import { BEBAS_NEUE_BASE64, INTER_TIGHT_BASE64 } from './fonts.ts';

// Brand font identifiers used in doc.setFont calls. The .ttf files live under
// fonts/ and are bundled as base64 strings via scripts/encode-fonts.mjs.
const BRAND_DISPLAY_FONT = 'BebasNeue';
const BRAND_BODY_FONT = 'InterTight';

const BUNDLE = 'pdf-worker';

const TEMPLATES = [
  { id: 'invoice', label: 'Invoice', entity_type: 'invoice' },
  { id: 'quote', label: 'Quote', entity_type: 'quote' },
  { id: 'purchase_order', label: 'Purchase order', entity_type: 'purchase_order' },
] as const;

// ---------------------------------------------------------------------------
// Body schemas. Each template names exactly the fields the renderer reads;
// extra fields are stripped by zod's default strip mode. Cents-as-string is
// the wire shape (BIGINT columns serialise to string from PostgREST).
// ---------------------------------------------------------------------------

const LineItemSchema = z.object({
  description: z.string(),
  quantity: z.union([z.number(), z.string()]),
  unit_price_cents: z.union([z.number(), z.string()]),
  line_total_cents: z.union([z.number(), z.string()]),
});

const InvoiceDataSchema = z.object({
  customer_display_name: z.string(),
  invoice_number: z.string(),
  issue_date: z.string(),
  due_date: z.string(),
  lines: z.array(LineItemSchema),
  subtotal_cents: z.union([z.number(), z.string()]),
  tax_cents: z.union([z.number(), z.string()]),
  total_cents: z.union([z.number(), z.string()]),
  currency: z.string().default('USD'),
});

// ADR 0004: a tiered quote sends its tiers (each with its own lines and total);
// renderQuote draws a section per tier instead of one flat line table. The flat
// `lines` / header totals are still sent (empty for a tiered quote) so the schema
// shape is stable; the renderer branches on a non-empty `tiers`.
const QuoteTierPdfSchema = z.object({
  label: z.string(),
  break_quantity: z.union([z.number(), z.string()]).default(0),
  total_cents: z.union([z.number(), z.string()]),
  lines: z.array(LineItemSchema),
});

const QuoteDataSchema = z.object({
  customer_display_name: z.string(),
  quote_number: z.string(),
  issue_date: z.string(),
  lines: z.array(LineItemSchema),
  subtotal_cents: z.union([z.number(), z.string()]),
  tax_cents: z.union([z.number(), z.string()]),
  total_cents: z.union([z.number(), z.string()]),
  currency: z.string().default('USD'),
  tiers: z.array(QuoteTierPdfSchema).optional(),
});

const PurchaseOrderDataSchema = z.object({
  vendor_display_name: z.string(),
  po_number: z.string(),
  issue_date: z.string(),
  lines: z.array(LineItemSchema),
  subtotal_cents: z.union([z.number(), z.string()]),
  total_cents: z.union([z.number(), z.string()]),
  currency: z.string().default('USD'),
});

const RenderRequestSchema = z.discriminatedUnion('template', [
  z.object({ template: z.literal('invoice'), data: InvoiceDataSchema }),
  z.object({ template: z.literal('quote'), data: QuoteDataSchema }),
  z.object({ template: z.literal('purchase_order'), data: PurchaseOrderDataSchema }),
]);

// ---------------------------------------------------------------------------
// Brand palette and page constants.
// ---------------------------------------------------------------------------

// Tailwind tokens: navy `#0a1628`, ink `#f5f1e8`, accent `#c8102e`.
const NAVY = { r: 10, g: 22, b: 40 };
const INK = { r: 245, g: 241, b: 232 };
const INK_DIM = { r: 140, g: 140, b: 140 };
const TEXT = { r: 30, g: 30, b: 30 };

const PAGE_W = 612; // US Letter pt
const PAGE_H = 792;
const MARGIN_X = 48;
const HEADER_H = 60;
const FOOTER_Y = PAGE_H - 36;
const LINE_ROW_H = 18;
const PAGE_BOTTOM_LIMIT = PAGE_H - 120; // leave room for totals plus footer

interface NormalisedLine {
  description: string;
  quantity: string;
  unit_price_cents: number;
  line_total_cents: number;
}

function asCents(v: number | string): number {
  const n = typeof v === 'string' ? Number(v) : v;
  if (!Number.isFinite(n)) throw new Error('Invalid cents value');
  return n;
}

function normaliseLine(line: z.infer<typeof LineItemSchema>): NormalisedLine {
  return {
    description: line.description,
    quantity: String(line.quantity),
    unit_price_cents: asCents(line.unit_price_cents),
    line_total_cents: asCents(line.line_total_cents),
  };
}

function setFill(doc: jsPDF, c: { r: number; g: number; b: number }): void {
  doc.setFillColor(c.r, c.g, c.b);
}

function setText(doc: jsPDF, c: { r: number; g: number; b: number }): void {
  doc.setTextColor(c.r, c.g, c.b);
}

/**
 * Register the brand fonts on a fresh jsPDF document. Bebas Neue is display
 * only (no bold weight in the free version), so callers use it via
 * setFont(BRAND_DISPLAY_FONT, 'normal'). Inter Tight covers the body type
 * and is also registered as 'normal' only; if a future template needs bold
 * or italic body text, embed the matching .ttf and file a follow-up.
 */
function applyBrandFonts(doc: jsPDF): void {
  doc.addFileToVFS('BebasNeue.ttf', BEBAS_NEUE_BASE64);
  doc.addFont('BebasNeue.ttf', BRAND_DISPLAY_FONT, 'normal');
  doc.addFileToVFS('InterTight.ttf', INTER_TIGHT_BASE64);
  doc.addFont('InterTight.ttf', BRAND_BODY_FONT, 'normal');
}

function drawHeaderBand(doc: jsPDF, docTypeLabel: string): void {
  setFill(doc, NAVY);
  doc.rect(0, 0, PAGE_W, HEADER_H, 'F');
  setText(doc, INK);
  doc.setFont(BRAND_DISPLAY_FONT, 'normal');
  doc.setFontSize(28);
  doc.text('KITSTAK', MARGIN_X, 38);
  doc.setFontSize(20);
  doc.text(docTypeLabel, PAGE_W - MARGIN_X, 38, { align: 'right' });
}

function drawFooter(doc: jsPDF, pageNum: number, pageCount: number): void {
  setText(doc, INK_DIM);
  doc.setFont(BRAND_BODY_FONT, 'normal');
  doc.setFontSize(9);
  doc.text('Built to Ship.', MARGIN_X, FOOTER_Y);
  doc.text(
    `Page ${pageNum} of ${pageCount}`,
    PAGE_W - MARGIN_X,
    FOOTER_Y,
    { align: 'right' },
  );
}

function drawLineHeader(doc: jsPDF, y: number): void {
  setText(doc, INK_DIM);
  // Section labels use the display font at small size for the constitutional
  // uppercase tracking look. Bebas Neue has no bold weight; the larger
  // x-height already reads as emphasis.
  doc.setFont(BRAND_DISPLAY_FONT, 'normal');
  doc.setFontSize(10);
  doc.text('DESCRIPTION', MARGIN_X, y);
  doc.text('QTY', 360, y, { align: 'right' });
  doc.text('UNIT', 450, y, { align: 'right' });
  doc.text('LINE TOTAL', PAGE_W - MARGIN_X, y, { align: 'right' });
  setFill(doc, INK_DIM);
  doc.rect(MARGIN_X, y + 4, PAGE_W - MARGIN_X * 2, 0.5, 'F');
}

function drawLineRow(
  doc: jsPDF,
  y: number,
  line: NormalisedLine,
  currency: string,
): void {
  setText(doc, TEXT);
  doc.setFont(BRAND_BODY_FONT, 'normal');
  doc.setFontSize(10);
  // Truncate very long descriptions to fit the column. 60 chars is the rough
  // limit for the body 10pt column at 300pt wide.
  const desc =
    line.description.length > 60
      ? `${line.description.slice(0, 57)}...`
      : line.description;
  doc.text(desc, MARGIN_X, y);
  doc.text(line.quantity, 360, y, { align: 'right' });
  doc.text(formatCents(line.unit_price_cents, currency), 450, y, {
    align: 'right',
  });
  doc.text(formatCents(line.line_total_cents, currency), PAGE_W - MARGIN_X, y, {
    align: 'right',
  });
}

function drawRecipientBlock(
  doc: jsPDF,
  y: number,
  labelPairs: Array<[string, string]>,
): number {
  setText(doc, INK_DIM);
  doc.setFont(BRAND_DISPLAY_FONT, 'normal');
  doc.setFontSize(10);
  let cursor = y;
  for (const [label, value] of labelPairs) {
    doc.text(label.toUpperCase(), MARGIN_X, cursor);
    setText(doc, TEXT);
    doc.setFont(BRAND_BODY_FONT, 'normal');
    doc.setFontSize(11);
    doc.text(value, MARGIN_X + 120, cursor);
    setText(doc, INK_DIM);
    doc.setFont(BRAND_DISPLAY_FONT, 'normal');
    doc.setFontSize(10);
    cursor += 16;
  }
  return cursor;
}

function drawTotalsBlock(
  doc: jsPDF,
  y: number,
  pairs: Array<[string, number]>,
  currency: string,
): void {
  setText(doc, TEXT);
  let cursor = y;
  for (const [label, cents] of pairs) {
    const isTotal = label === 'Total';
    // Total uses the display font for emphasis; subtotal and tax rows stay on
    // the body font.
    doc.setFont(isTotal ? BRAND_DISPLAY_FONT : BRAND_BODY_FONT, 'normal');
    doc.setFontSize(isTotal ? 14 : 11);
    doc.text(label, PAGE_W - MARGIN_X - 140, cursor, { align: 'right' });
    doc.text(formatCents(cents, currency), PAGE_W - MARGIN_X, cursor, {
      align: 'right',
    });
    cursor += isTotal ? 20 : 16;
  }
}

// ---------------------------------------------------------------------------
// Renderers.
// ---------------------------------------------------------------------------

function renderInvoice(data: z.infer<typeof InvoiceDataSchema>): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  applyBrandFonts(doc);
  const lines = data.lines.map(normaliseLine);
  const currency = data.currency;
  drawAllPages(doc, 'INVOICE', lines, currency, (cursorY) => {
    let y = cursorY;
    y = drawRecipientBlock(doc, y, [
      ['Bill to', data.customer_display_name],
      ['Invoice', data.invoice_number],
      ['Issue date', data.issue_date],
      ['Due date', data.due_date],
    ]);
    return y + 12;
  }, () =>
    drawTotalsBlock(
      doc,
      PAGE_BOTTOM_LIMIT + 4,
      [
        ['Subtotal', asCents(data.subtotal_cents)],
        ['Tax', asCents(data.tax_cents)],
        ['Total', asCents(data.total_cents)],
      ],
      currency,
    ),
  );
  return doc;
}

function renderQuote(data: z.infer<typeof QuoteDataSchema>): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  applyBrandFonts(doc);
  const currency = data.currency;
  // ADR 0004: a tiered quote renders a section per tier (its own lines + total),
  // not a single flat table with one header total.
  if (data.tiers && data.tiers.length > 0) {
    renderTieredQuote(doc, data, data.tiers, currency);
    return doc;
  }
  const lines = data.lines.map(normaliseLine);
  drawAllPages(doc, 'QUOTE', lines, currency, (cursorY) => {
    let y = cursorY;
    y = drawRecipientBlock(doc, y, [
      ['Prepared for', data.customer_display_name],
      ['Quote', data.quote_number],
      ['Issue date', data.issue_date],
    ]);
    return y + 12;
  }, () =>
    drawTotalsBlock(
      doc,
      PAGE_BOTTOM_LIMIT + 4,
      [
        ['Subtotal', asCents(data.subtotal_cents)],
        ['Tax', asCents(data.tax_cents)],
        ['Total', asCents(data.total_cents)],
      ],
      currency,
    ),
  );
  return doc;
}

// ADR 0004: per-tier sections for a tiered quote. Each tier draws its label (with
// the break quantity when set), its own line table, and a per-tier total. There
// is no single header total: a tiered quote carries totals at the tier grain.
function renderTieredQuote(
  doc: jsPDF,
  data: z.infer<typeof QuoteDataSchema>,
  tiers: z.infer<typeof QuoteTierPdfSchema>[],
  currency: string,
): void {
  const MAX_PAGES = 10;
  let pageNum = 1;
  drawHeaderBand(doc, 'QUOTE');
  let y = drawRecipientBlock(doc, HEADER_H + 28, [
    ['Prepared for', data.customer_display_name],
    ['Quote', data.quote_number],
    ['Issue date', data.issue_date],
  ]);
  y += 12;

  const newPage = (label: string): number => {
    doc.addPage();
    pageNum += 1;
    drawHeaderBand(doc, label);
    return HEADER_H + 28;
  };

  for (const tier of tiers) {
    // Keep a tier label, its line header, and at least one row together.
    if (y + 60 > PAGE_BOTTOM_LIMIT && pageNum < MAX_PAGES) {
      y = newPage('QUOTE (cont.)');
    }
    setText(doc, TEXT);
    doc.setFont(BRAND_DISPLAY_FONT, 'normal');
    doc.setFontSize(14);
    const breakQty = Number(tier.break_quantity);
    const heading = breakQty > 0 ? `${tier.label} (from ${tier.break_quantity})` : tier.label;
    doc.text(heading, MARGIN_X, y);
    y += 18;
    drawLineHeader(doc, y);
    y += 18;

    for (const line of tier.lines.map(normaliseLine)) {
      if (y + LINE_ROW_H > PAGE_BOTTOM_LIMIT) {
        if (pageNum >= MAX_PAGES) break;
        y = newPage('QUOTE (cont.)');
        drawLineHeader(doc, y);
        y += 18;
      }
      drawLineRow(doc, y, line, currency);
      y += LINE_ROW_H;
    }

    if (y + 24 > PAGE_BOTTOM_LIMIT && pageNum < MAX_PAGES) {
      y = newPage('QUOTE (cont.)');
    }
    setText(doc, TEXT);
    doc.setFont(BRAND_DISPLAY_FONT, 'normal');
    doc.setFontSize(12);
    doc.text('Tier total', PAGE_W - MARGIN_X - 140, y, { align: 'right' });
    doc.text(formatCents(asCents(tier.total_cents), currency), PAGE_W - MARGIN_X, y, {
      align: 'right',
    });
    y += 28;
  }

  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    drawFooter(doc, p, pageCount);
  }
}

function renderPurchaseOrder(
  data: z.infer<typeof PurchaseOrderDataSchema>,
): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  applyBrandFonts(doc);
  const lines = data.lines.map(normaliseLine);
  const currency = data.currency;
  drawAllPages(doc, 'PURCHASE ORDER', lines, currency, (cursorY) => {
    let y = cursorY;
    y = drawRecipientBlock(doc, y, [
      ['Vendor', data.vendor_display_name],
      ['PO number', data.po_number],
      ['Issue date', data.issue_date],
    ]);
    return y + 12;
  }, () =>
    drawTotalsBlock(
      doc,
      PAGE_BOTTOM_LIMIT + 4,
      [
        ['Subtotal', asCents(data.subtotal_cents)],
        ['Total', asCents(data.total_cents)],
      ],
      currency,
    ),
  );
  return doc;
}

/**
 * Paginate the line items across as many pages as needed. The first page
 * renders the doc-specific recipient block (returned y becomes the table
 * start), subsequent pages skip straight to the line header. The totals
 * block is drawn once on the last page.
 */
function drawAllPages(
  doc: jsPDF,
  docTypeLabel: string,
  lines: NormalisedLine[],
  currency: string,
  drawFirstPageHead: (cursorY: number) => number,
  drawTotals: () => void,
): void {
  const MAX_PAGES = 10;

  // First-page head computes the table start; pre-compute pagination from
  // there.
  drawHeaderBand(doc, docTypeLabel);
  let tableStartY = drawFirstPageHead(HEADER_H + 28);
  let pageNum = 1;
  drawLineHeader(doc, tableStartY);
  let cursor = tableStartY + 18;

  for (let i = 0; i < lines.length; i++) {
    if (cursor + LINE_ROW_H > PAGE_BOTTOM_LIMIT) {
      if (pageNum >= MAX_PAGES) {
        // Drop overflow lines silently; v1 caps at 10 pages per the spec.
        break;
      }
      doc.addPage();
      pageNum += 1;
      drawHeaderBand(doc, `${docTypeLabel} (cont.)`);
      tableStartY = HEADER_H + 28;
      drawLineHeader(doc, tableStartY);
      cursor = tableStartY + 18;
    }
    drawLineRow(doc, cursor, lines[i], currency);
    cursor += LINE_ROW_H;
  }

  // Totals block on the last (current) page.
  drawTotals();

  // Footer on every page. jsPDF tracks pages internally.
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    drawFooter(doc, p, pageCount);
  }
}

// ---------------------------------------------------------------------------
// Routes.
// ---------------------------------------------------------------------------

const listTemplates: Route = {
  method: 'GET',
  path: '/pdf/templates',
  async handler({ req }) {
    const caller = requireCaller(req);
    requireCap(caller, 'pdf.document.render');
    return ok({ items: TEMPLATES });
  },
};

const render: Route = {
  method: 'POST',
  path: '/pdf/render',
  async handler({ req }) {
    const caller = requireCaller(req);
    requireCap(caller, 'pdf.document.render');
    const body = await parseBody(req, RenderRequestSchema);

    return respondWithIdempotency(
      req,
      caller,
      BUNDLE,
      '/pdf/render',
      body,
      async () => {
        let doc: jsPDF;
        if (body.template === 'invoice') {
          doc = renderInvoice(body.data);
        } else if (body.template === 'quote') {
          doc = renderQuote(body.data);
        } else {
          doc = renderPurchaseOrder(body.data);
        }

        const buf = doc.output('arraybuffer');
        const base64 = toBase64(new Uint8Array(buf));
        return ok({ url: `data:application/pdf;base64,${base64}` });
      },
    );
  },
};

/**
 * Chunked base64 encoder. `btoa(String.fromCharCode(...arr))` blows the call
 * stack for buffers larger than ~100kB; this version walks the buffer in
 * 8kB slices so it stays correct for arbitrary PDFs. Pure browser-platform
 * code, no Node Buffer involved, so it runs identically under Deno and the
 * Vitest harness.
 */
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode.apply(null, Array.from(slice));
  }
  return btoa(binary);
}

Deno.serve((req) => route(req, [listTemplates, render], { bundle: BUNDLE }));

export { listTemplates, render, TEMPLATES, RenderRequestSchema };
