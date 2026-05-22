// UX-Q6: unit tests for the `?project_id=` query-param guard.
//
// Both ReceivingOrderCreatePage and ReceivingOrdersListPage read the
// `project_id` query param from the URL. A malformed value (missing,
// non-string, non-UUID) must NOT propagate to the picker or to the API
// — the function falls back to null. Same shape as PR #103's
// parseEntityTypeParam.

import { describe, expect, it } from 'vitest';
import { parseProjectIdParam } from './receivingProjectParam';

describe('parseProjectIdParam', () => {
  it('returns null when the param is null', () => {
    expect(parseProjectIdParam(null)).toBeNull();
  });

  it('returns null when the param is undefined', () => {
    expect(parseProjectIdParam(undefined)).toBeNull();
  });

  it('returns null when the param is an empty string', () => {
    expect(parseProjectIdParam('')).toBeNull();
  });

  it('returns null when the param is not a UUID', () => {
    expect(parseProjectIdParam('not-a-uuid')).toBeNull();
    expect(parseProjectIdParam('abc123')).toBeNull();
    // Almost-a-UUID but missing a hex group.
    expect(parseProjectIdParam('00000000-0000-4000-8000-00000000')).toBeNull();
  });

  it('returns the value when the param is a canonical lower-case UUID', () => {
    const id = '00000000-0000-4000-8000-0000000000d1';
    expect(parseProjectIdParam(id)).toBe(id);
  });

  it('returns the value when the param is a canonical upper-case UUID', () => {
    const id = '00000000-0000-4000-8000-0000000000D1';
    expect(parseProjectIdParam(id)).toBe(id);
  });

  it('returns null for a non-string input cast (defence in depth)', () => {
    // useSearchParams.get returns string | null. A defensive cast is
    // still worth a test in case a caller passes a number from a
    // different param source.
    expect(parseProjectIdParam(42 as unknown as string)).toBeNull();
    expect(parseProjectIdParam({} as unknown as string)).toBeNull();
  });
});
