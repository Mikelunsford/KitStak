// UX-Q8 / F-Wave10-SMOKE-CONFIRM-MODAL-01: regression tests for the
// destructive-transition confirm helper. Pure-logic, no React imports, no
// Supabase singleton, no jsdom dependency. destructiveConfirm is now backed by
// the in-app modal via a registered opener (setConfirmOpener); the tests drive
// it with a fake opener instead of stubbing window.confirm.
import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  destructiveConfirm,
  formatDestructiveMessage,
  setConfirmOpener,
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
    setConfirmOpener(null);
  });

  it('resolves true when the modal host confirms', async () => {
    const opener = vi.fn().mockResolvedValue(true);
    setConfirmOpener(opener);
    const result = await destructiveConfirm({
      action: 'Cancel this quote',
      consequence: 'The quote will move to cancelled.',
    });
    expect(result).toBe(true);
    expect(opener).toHaveBeenCalledTimes(1);
  });

  it('resolves false when the modal host cancels', async () => {
    setConfirmOpener(vi.fn().mockResolvedValue(false));
    const result = await destructiveConfirm({
      action: 'Cancel this quote',
      consequence: 'The quote will move to cancelled.',
    });
    expect(result).toBe(false);
  });

  it('passes the options through to the registered opener', async () => {
    const opener = vi.fn().mockResolvedValue(true);
    setConfirmOpener(opener);
    const opts = {
      action: 'Complete this manufacturing run',
      consequence: 'This writes production stock movements.',
      irreversible: true,
    };
    await destructiveConfirm(opts);
    expect(opener).toHaveBeenCalledWith(opts);
  });

  it('resolves false (never destructive) when no host is registered', async () => {
    setConfirmOpener(null);
    const result = await destructiveConfirm({
      action: 'Cancel this quote',
      consequence: 'The quote will move to cancelled.',
    });
    expect(result).toBe(false);
  });
});
