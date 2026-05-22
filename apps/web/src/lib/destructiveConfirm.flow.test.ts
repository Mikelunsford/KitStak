// UX-Q8: smoke tests for the destructive-confirm flow at the call-site
// contract level. These assert the pattern every detail-page onClick
// follows:
//
//   1. Call destructiveConfirm.
//   2. If it returns false, short-circuit. Do NOT call the mutation.
//   3. If it returns true, call the mutation exactly once.
//
// We don't render the full detail pages here because that would force
// us to load the Supabase singleton and TanStack Query providers — the
// same trade-off PR #103 made with parseEntityTypeParam.ts. The flow
// itself is a pure function of `destructiveConfirm`'s return value, so
// testing the contract once at the helper boundary covers every
// onClick that uses the pattern.
import { describe, it, expect, vi, afterEach } from 'vitest';

import { destructiveConfirm } from './destructiveConfirm';

/**
 * Mirrors the shape of every UX-Q8 onClick in the codebase.
 * Returns true if the mutation ran, false if it was short-circuited.
 */
function simulateDestructiveTransition(
  mutation: () => void,
  opts: Parameters<typeof destructiveConfirm>[0],
): boolean {
  if (!destructiveConfirm(opts)) return false;
  mutation();
  return true;
}

describe('destructive transition onClick flow', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('invokes window.confirm BEFORE the mutation', () => {
    const order: string[] = [];
    const confirmStub = vi.fn().mockImplementation(() => {
      order.push('confirm');
      return true;
    });
    vi.stubGlobal('window', { confirm: confirmStub });
    const mutation = vi.fn().mockImplementation(() => {
      order.push('mutation');
    });

    simulateDestructiveTransition(mutation, {
      action: 'Cancel this quote',
      consequence: 'The quote will move to cancelled.',
    });

    expect(order).toEqual(['confirm', 'mutation']);
  });

  it('does NOT call the mutation when the operator cancels the confirm', () => {
    vi.stubGlobal('window', { confirm: vi.fn().mockReturnValue(false) });
    const mutation = vi.fn();

    const ran = simulateDestructiveTransition(mutation, {
      action: 'Cancel this invoice',
      consequence: 'The invoice will move to cancelled.',
    });

    expect(ran).toBe(false);
    expect(mutation).not.toHaveBeenCalled();
  });

  it('DOES call the mutation exactly once when the operator confirms', () => {
    vi.stubGlobal('window', { confirm: vi.fn().mockReturnValue(true) });
    const mutation = vi.fn();

    const ran = simulateDestructiveTransition(mutation, {
      action: 'Complete this manufacturing run',
      consequence: 'This writes production stock movements.',
      irreversible: true,
    });

    expect(ran).toBe(true);
    expect(mutation).toHaveBeenCalledTimes(1);
  });
});
