// F-UIUX-TOASTS-ROLLOUT-01: pin the invoice-created next-step message. Pure-TS
// suite (mirrors quoteCreatedToast.test.ts).

import { describe, it, expect } from 'vitest';

import { invoiceCreatedMessage } from './invoiceCreatedToast';

describe('invoiceCreatedMessage', () => {
  it('points at adding lines when none were staged', () => {
    expect(invoiceCreatedMessage('INV-2026-00001', 0)).toBe(
      'Invoice INV-2026-00001 created. Add line items to build it out.',
    );
  });

  it('points at issuing and sending when lines were staged', () => {
    expect(invoiceCreatedMessage('INV-2026-00001', 3)).toBe(
      'Invoice INV-2026-00001 created with 3 lines. Issue and send it next.',
    );
  });

  it('singularises a single staged line', () => {
    expect(invoiceCreatedMessage('INV-2026-00001', 1)).toBe(
      'Invoice INV-2026-00001 created with 1 line. Issue and send it next.',
    );
  });

  it('falls back to a generic subject when the number is missing', () => {
    expect(invoiceCreatedMessage(null, 0)).toBe(
      'Invoice created. Add line items to build it out.',
    );
    expect(invoiceCreatedMessage(undefined, 2)).toBe(
      'Invoice created with 2 lines. Issue and send it next.',
    );
  });

  it('produces branding-clean copy (no em dash or double hyphen)', () => {
    for (const msg of [
      invoiceCreatedMessage('INV-1', 0),
      invoiceCreatedMessage('INV-1', 1),
      invoiceCreatedMessage('INV-1', 5),
    ]) {
      expect(msg).not.toMatch(/—/);
      expect(msg).not.toMatch(/--/);
    }
  });
});
