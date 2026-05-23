// F-Wave9-AUDIT-V3-WAVE-C3-01: tests for the shared URL query-param
// guards. Lifted from receivingProjectParam.test.ts after the parser
// moved into `lib/urlParams.ts` so the same guarantees apply across
// every create page that accepts deep-link prefill.

import { describe, expect, it } from 'vitest';

import { parseProjectIdParam } from './urlParams';

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
    expect(parseProjectIdParam(42 as unknown as string)).toBeNull();
    expect(parseProjectIdParam({} as unknown as string)).toBeNull();
  });
});
