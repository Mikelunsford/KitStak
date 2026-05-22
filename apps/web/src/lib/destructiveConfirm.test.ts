// UX-Q8: regression tests for the destructive-transition confirm
// wrapper. Pure-logic, no React imports, no Supabase singleton, no
// jsdom dependency. The `window` global is stubbed manually via
// vi.stubGlobal so the test suite runs in the project's default node
// vitest environment (matches the convention used by money.test.ts and
// safePath.test.ts).
import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  destructiveConfirm,
  formatDestructiveMessage,
} from './destructiveConfirm';

describe('formatDestructiveMessage', () => {
  it('concatenates action + consequence + footer when irreversible: true', () => {
    const msg = formatDestructiveMessage({
      action: 'Complete this manufacturing run',
      consequence: 'This writes production stock movements.',
      irreversible: true,
    });
    expect(msg).toContain('Complete this manufacturing run?');
    expect(msg).toContain('This writes production stock movements.');
    expect(msg).toContain('This action cannot be undone.');
  });

  it('omits the footer when irreversible is false or missing', () => {
    const a = formatDestructiveMessage({
      action: 'Cancel this quote',
      consequence: 'The quote will move to cancelled.',
    });
    const b = formatDestructiveMessage({
      action: 'Cancel this project',
      consequence: 'The project will move to cancelled.',
      irreversible: false,
    });
    expect(a).not.toContain('cannot be undone');
    expect(b).not.toContain('cannot be undone');
  });
});

describe('destructiveConfirm', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns true when window.confirm returns true', () => {
    const confirmStub = vi.fn().mockReturnValue(true);
    vi.stubGlobal('window', { confirm: confirmStub });
    const result = destructiveConfirm({
      action: 'Cancel this quote',
      consequence: 'The quote will move to cancelled.',
    });
    expect(result).toBe(true);
    expect(confirmStub).toHaveBeenCalledTimes(1);
  });

  it('returns false when window.confirm returns false', () => {
    const confirmStub = vi.fn().mockReturnValue(false);
    vi.stubGlobal('window', { confirm: confirmStub });
    const result = destructiveConfirm({
      action: 'Cancel this quote',
      consequence: 'The quote will move to cancelled.',
    });
    expect(result).toBe(false);
  });

  it('passes the formatted message including the irreversible footer to window.confirm', () => {
    const confirmStub = vi.fn().mockReturnValue(true);
    vi.stubGlobal('window', { confirm: confirmStub });
    destructiveConfirm({
      action: 'Complete this manufacturing run',
      consequence: 'This writes production stock movements.',
      irreversible: true,
    });
    expect(confirmStub).toHaveBeenCalledTimes(1);
    const message = confirmStub.mock.calls[0]?.[0];
    expect(message).toBeDefined();
    expect(message).toContain('Complete this manufacturing run?');
    expect(message).toContain('This writes production stock movements.');
    expect(message).toContain('This action cannot be undone.');
  });

  it('passes the formatted message without the footer when irreversible is missing', () => {
    const confirmStub = vi.fn().mockReturnValue(true);
    vi.stubGlobal('window', { confirm: confirmStub });
    destructiveConfirm({
      action: 'Cancel this quote',
      consequence: 'The quote will move to cancelled.',
    });
    const message = confirmStub.mock.calls[0]?.[0];
    expect(message).toBeDefined();
    expect(message).not.toContain('cannot be undone');
  });
});
