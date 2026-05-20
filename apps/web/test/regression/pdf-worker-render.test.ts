// Regression suite for F-Wave2-CO-01 — pdf-worker real render via jsPDF.
//
// The pre-F-Wave2-CO-01 stub returned 501 PDF_NOT_YET_AVAILABLE. The
// operator approved jsPDF as the rendering dependency. This test exercises
// the POST /pdf/render route end-to-end through the captured handler:
//
//   * 200 status (no longer 501).
//   * Response body shape: { data: { url: 'data:application/pdf;base64,...' } }.
//   * The decoded base64 starts with the PDF magic bytes '%PDF-'.
//
// We deliberately do NOT snapshot the binary PDF body. PDF output is
// timestamp-stamped (jsPDF embeds /CreationDate by default) and any
// font-metric tweak in jsPDF will rewrite the entire byte stream. The
// magic-byte check is enough to prove a real PDF was produced; the visual
// fidelity is operator-verified on the Download PDF button on
// InvoiceDetailPage.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  installDenoShim,
  capturedHandler,
  resetCapturedHandler,
} from './_helpers/deno-shim.ts';
import { bearer, makeState } from './_helpers/supabase-mock.ts';
import {
  setActiveMockState,
  clearActiveMockState,
} from './_helpers/supabase-stub.ts';

const ORG_A = '00000000-0000-4000-8000-0000000000a1';
const USER_A = '00000000-0000-4000-8000-0000000000b1';
const OWNER = { userId: USER_A, orgId: ORG_A, role: 'org_owner' as const };

const MINIMAL_INVOICE_PAYLOAD = {
  customer_display_name: 'Acme Logistics',
  invoice_number: 'INV-0001',
  issue_date: '2026-05-19',
  due_date: '2026-06-18',
  lines: [
    {
      description: 'Pallet receiving',
      quantity: '2',
      unit_price_cents: '12500',
      line_total_cents: '25000',
    },
  ],
  subtotal_cents: '25000',
  tax_cents: '0',
  total_cents: '25000',
  currency: 'USD',
};

async function readJson(res: Response): Promise<{ data?: { url?: string }; error?: { code: string; message: string } }> {
  return JSON.parse(await res.text());
}

function decodeBase64Prefix(dataUrl: string): string {
  // Strip the data-url scheme and decode just the first 8 bytes; that is
  // sufficient to verify the PDF magic prefix '%PDF-'.
  const base64 = dataUrl.replace(/^data:application\/pdf;base64,/, '');
  const head = base64.slice(0, 16);
  const binary = atob(head);
  return binary.slice(0, 5);
}

function decodeFullPdf(dataUrl: string): { binary: string; bytes: number } {
  const base64 = dataUrl.replace(/^data:application\/pdf;base64,/, '');
  const binary = atob(base64);
  return { binary, bytes: binary.length };
}

describe('pdf-worker — POST /pdf/render (F-Wave2-CO-01)', () => {
  let handler: (req: Request) => Promise<Response> | Response;

  beforeAll(async () => {
    installDenoShim();
    resetCapturedHandler();
    await import('../../../../supabase/functions/pdf-worker/index.ts');
    handler = capturedHandler();
  });

  afterEach(() => clearActiveMockState());

  it('returns 200 with a data-url PDF for a minimal invoice payload', async () => {
    setActiveMockState(makeState({}));

    const req = new Request('https://example.test/pdf/render', {
      method: 'POST',
      headers: {
        authorization: bearer(OWNER),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        template: 'invoice',
        data: MINIMAL_INVOICE_PAYLOAD,
      }),
    });

    const res = await handler(req);
    expect(res.status).toBe(200);

    const body = await readJson(res);
    expect(body.data?.url).toMatch(/^data:application\/pdf;base64,/);

    // Magic-byte check: every real PDF starts with '%PDF-' (0x25 50 44 46 2D).
    const head = decodeBase64Prefix(body.data!.url!);
    expect(head).toBe('%PDF-');
  });

  it('embeds the brand fonts (BebasNeue + InterTight) in the rendered PDF (F-Wave8-PDF-FONT-EMBED-01)', async () => {
    setActiveMockState(makeState({}));

    const req = new Request('https://example.test/pdf/render', {
      method: 'POST',
      headers: {
        authorization: bearer(OWNER),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        template: 'invoice',
        data: MINIMAL_INVOICE_PAYLOAD,
      }),
    });

    const res = await handler(req);
    expect(res.status).toBe(200);

    const body = await readJson(res);
    const { binary, bytes } = decodeFullPdf(body.data!.url!);

    // Both brand fonts must appear in the binary PDF byte stream. jsPDF
    // writes the registered name as a PostScript-style identifier when it
    // embeds the font subset, so a substring match is sufficient.
    expect(binary).toContain('BebasNeue');
    expect(binary).toContain('InterTight');

    // Sanity bound: a minimal 1-line invoice with both fonts subsetted should
    // stay well under 2 MB. If this fires the worker is shipping the full
    // unsubsetted font tables and needs investigation.
    expect(bytes).toBeLessThan(2_000_000);
  });

  it('rejects an invoice payload missing required fields with 422', async () => {
    setActiveMockState(makeState({}));

    const req = new Request('https://example.test/pdf/render', {
      method: 'POST',
      headers: {
        authorization: bearer(OWNER),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        template: 'invoice',
        data: { invoice_number: 'INV-0002' }, // missing every other required field
      }),
    });

    const res = await handler(req);
    expect(res.status).toBe(422);
    const body = await readJson(res);
    expect(body.error?.code).toBe('VALIDATION_ERROR');
  });
});
