// UX-Q8 / F-Wave10-SMOKE-CONFIRM-MODAL-01: smoke tests for the destructive-
// confirm flow at the call-site contract level. These assert the pattern every
// detail-page onClick follows now that destructiveConfirm is async (backed by
// the in-app modal via setConfirmOpener):
//
//   1. await destructiveConfirm.
//   2. If it resolves false, short-circuit. Do NOT call the mutation.
//   3. If it resolves true, call the mutation exactly once.
//
// We don't render the full detail pages here (that would force the Supabase
// singleton + TanStack Query providers). The flow is a pure function of
// destructiveConfirm's resolved value, so testing the contract once at the
// helper boundary covers every onClick that uses the pattern.
import { describe, it, expect, vi, afterEach } from 'vitest';

import { destructiveConfirm, setConfirmOpener } from './destructiveConfirm';

/**
 * Mirrors the shape of every async destructive onClick in the codebase.
 * Resolves true if the mutation ran, false if it was short-circuited.
 */
async function simulateDestructiveTransition(
  mutation: () => void,
  opts: Parameters<typeof destructiveConfirm>[0],
): Promise<boolean> {
  if (!(await destructiveConfirm(opts))) return false;
  mutation();
  return true;
}

describe('destructive transition onClick flow', () => {
  afterEach(() => {
    setConfirmOpener(null);
  });

  it('opens the confirm modal BEFORE the mutation', async () => {
    const order: string[] = [];
    setConfirmOpener(async () => {
      order.push('confirm');
      return true;
    });
    const mutation = vi.fn().mockImplementation(() => {
      order.push('mutation');
    });

    await simulateDestructiveTransition(mutation, {
      action: 'Cancel this quote',
      consequence: 'The quote will move to cancelled.',
    });

    expect(order).toEqual(['confirm', 'mutation']);
  });

  it('does NOT call the mutation when the operator cancels the modal', async () => {
    setConfirmOpener(async () => false);
    const mutation = vi.fn();

    const ran = await simulateDestructiveTransition(mutation, {
      action: 'Cancel this invoice',
      consequence: 'The invoice will move to cancelled.',
    });

    expect(ran).toBe(false);
    expect(mutation).not.toHaveBeenCalled();
  });

  it('DOES call the mutation exactly once when the operator confirms', async () => {
    setConfirmOpener(async () => true);
    const mutation = vi.fn();

    const ran = await simulateDestructiveTransition(mutation, {
      action: 'Complete this manufacturing run',
      consequence: 'This writes production stock movements.',
      irreversible: true,
    });

    expect(ran).toBe(true);
    expect(mutation).toHaveBeenCalledTimes(1);
  });

  it('resolves false (never destructive) when no modal host is mounted', async () => {
    // SSR / node test env / before first paint: no opener registered.
    setConfirmOpener(null);
    const mutation = vi.fn();

    const ran = await simulateDestructiveTransition(mutation, {
      action: 'Delete this draft',
      consequence: 'The draft will be removed permanently.',
      irreversible: true,
    });

    expect(ran).toBe(false);
    expect(mutation).not.toHaveBeenCalled();
  });
});
