// F-UIUX-TOASTS-ROLLOUT-01: pin the PO-created next-step message. Pure-TS suite
// (mirrors quoteCreatedToast.test.ts).

import { describe, it, expect } from 'vitest';

import { poCreatedMessage } from './poCreatedToast';

describe('poCreatedMessage', () => {
  it('points at adding lines when none were staged', () => {
    expect(poCreatedMessage('PO-2026-00001', 0)).toBe(
      'PO PO-2026-00001 created. Add line items to build it out.',
    );
  });

  it('points at sending to the vendor when lines were staged', () => {
    expect(poCreatedMessage('PO-2026-00001', 3)).toBe(
      'PO PO-2026-00001 created with 3 lines. Send it to the vendor next.',
    );
  });

  it('singularises a single staged line', () => {
    expect(poCreatedMessage('PO-2026-00001', 1)).toBe(
      'PO PO-2026-00001 created with 1 line. Send it to the vendor next.',
    );
  });

  it('falls back to a generic subject when the number is missing', () => {
    expect(poCreatedMessage(null, 0)).toBe(
      'PO created. Add line items to build it out.',
    );
    expect(poCreatedMessage(undefined, 2)).toBe(
      'PO created with 2 lines. Send it to the vendor next.',
    );
  });

  it('produces branding-clean copy (no em dash or double hyphen)', () => {
    for (const msg of [
      poCreatedMessage('PO-1', 0),
      poCreatedMessage('PO-1', 1),
      poCreatedMessage('PO-1', 5),
    ]) {
      expect(msg).not.toMatch(/—/);
      expect(msg).not.toMatch(/--/);
    }
  });
});
