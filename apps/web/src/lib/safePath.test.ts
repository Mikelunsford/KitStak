// PR-6 / B6: regression tests for the same-origin path guard used by
// the `?return_to=` parameter on ContactCreatePage.
import { describe, it, expect } from 'vitest';

import { safeSameOriginPath } from './safePath';

describe('safeSameOriginPath', () => {
  it('accepts a simple absolute path', () => {
    expect(safeSameOriginPath('/crm/customers/abc')).toBe('/crm/customers/abc');
  });

  it('accepts a root path', () => {
    expect(safeSameOriginPath('/')).toBe('/');
  });

  it('accepts a path with query and hash', () => {
    expect(safeSameOriginPath('/crm/customers/abc?tab=contacts#a')).toBe(
      '/crm/customers/abc?tab=contacts#a',
    );
  });

  it('rejects null', () => {
    expect(safeSameOriginPath(null)).toBeNull();
  });

  it('rejects undefined', () => {
    expect(safeSameOriginPath(undefined)).toBeNull();
  });

  it('rejects empty string', () => {
    expect(safeSameOriginPath('')).toBeNull();
  });

  it('rejects relative path', () => {
    expect(safeSameOriginPath('crm/customers/abc')).toBeNull();
  });

  it('rejects protocol-relative URL (//evil.com)', () => {
    expect(safeSameOriginPath('//evil.com/x')).toBeNull();
  });

  it('rejects Windows-style protocol-relative URL (/\\\\evil.com)', () => {
    expect(safeSameOriginPath('/\\evil.com')).toBeNull();
  });

  it('rejects external http URL', () => {
    expect(safeSameOriginPath('http://evil.com')).toBeNull();
  });

  it('rejects external https URL', () => {
    expect(safeSameOriginPath('https://evil.com')).toBeNull();
  });

  it('rejects javascript: scheme even with leading /', () => {
    // Leading-slash form `javascript://...` is blocked because it does
    // not start with '/'. Add an explicit case for the spelling that
    // *would* fool a naive `startsWith('/')` check.
    expect(safeSameOriginPath('javascript:alert(1)')).toBeNull();
  });

  it('rejects a path containing :// anywhere', () => {
    expect(safeSameOriginPath('/redirect?to=https://evil.com')).toBeNull();
  });
});
