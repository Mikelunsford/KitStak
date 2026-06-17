// F-UIUX-TOASTS-01: pin the quote-created next-step message. Pure-TS suite.

import { describe, it, expect } from 'vitest';

import { quoteCreatedMessage } from './quoteCreatedToast';

describe('quoteCreatedMessage', () => {
  it('points at adding lines when none were staged', () => {
    expect(quoteCreatedMessage('Q-2026-00001', 0)).toBe(
      'Quote Q-2026-00001 created. Add line items to build it out.',
    );
  });

  it('points at sending for approval when lines were staged', () => {
    expect(quoteCreatedMessage('Q-2026-00001', 3)).toBe(
      'Quote Q-2026-00001 created with 3 lines. Send it for approval next.',
    );
  });

  it('singularises a single staged line', () => {
    expect(quoteCreatedMessage('Q-2026-00001', 1)).toBe(
      'Quote Q-2026-00001 created with 1 line. Send it for approval next.',
    );
  });

  it('falls back to a generic subject when the number is missing', () => {
    expect(quoteCreatedMessage(null, 0)).toBe(
      'Quote created. Add line items to build it out.',
    );
    expect(quoteCreatedMessage(undefined, 2)).toBe(
      'Quote created with 2 lines. Send it for approval next.',
    );
  });

  it('produces branding-clean copy (no em dash or double hyphen)', () => {
    for (const msg of [
      quoteCreatedMessage('Q-1', 0),
      quoteCreatedMessage('Q-1', 1),
      quoteCreatedMessage('Q-1', 5),
    ]) {
      expect(msg).not.toMatch(/—/);
      expect(msg).not.toMatch(/--/);
    }
  });
});
