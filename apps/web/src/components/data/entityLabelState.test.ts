// BNEW-8: regression tests for the EntityLabel render-state classifier.
//
// Before this fix the project field on ReceivingOrderDetailPage briefly
// rendered the raw FK UUID on first load while the underlying list
// query (useProjectsList) was still in flight. The fix differentiates
// "loading" (q.data === undefined) from "loaded but row missing" so the
// in-flight state can render a stable short-prefix placeholder and the
// genuinely-missing case keeps the diagnosable raw id.

import { describe, it, expect } from 'vitest';

import { classifyEntityLabel } from './entityLabelState';

const ID_A = '24f5ae58-789c-4b1d-9c3f-674b4aadc4d5';
const ID_B = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

describe('classifyEntityLabel', () => {
  it('returns "pending" when the list query has not settled (data undefined)', () => {
    expect(classifyEntityLabel(undefined, ID_A)).toBe('pending');
  });

  it('returns "found" when the list contains the id', () => {
    const data = [
      { id: ID_A, label: 'Project A' },
      { id: ID_B, label: 'Project B' },
    ];
    expect(classifyEntityLabel(data, ID_A)).toBe('found');
  });

  it('returns "missing" when the list settled but does not contain the id', () => {
    const data: Array<{ id: string }> = [];
    expect(classifyEntityLabel(data, ID_A)).toBe('missing');
  });

  it('treats an empty list as settled (missing, not pending)', () => {
    // The operator's first-load smoke saw a raw UUID flash before
    // useProjectsList resolved. After the fix, an empty list is a
    // settled state and we render the id; an undefined data is the
    // in-flight state and we render the placeholder.
    expect(classifyEntityLabel([], ID_A)).toBe('missing');
    expect(classifyEntityLabel(undefined, ID_A)).toBe('pending');
  });
});
