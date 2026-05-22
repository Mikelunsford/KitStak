// PR-6 / B6: helper to validate a `?return_to=` query param before
// passing it to `navigate(...)`. The constitutional concern is open-
// redirect: an attacker could craft a link with
// `?return_to=https://evil.com` and bounce an authenticated session out
// of the SPA after a successful mutation. We allow only same-origin
// absolute paths.
//
// Rules:
//   - Must start with a single '/'
//   - Must NOT contain '://' (catches http://, https://, javascript:, etc.)
//   - Must NOT start with '//' (protocol-relative URLs)
//   - Must NOT start with '/\' (Windows-style protocol-relative)
//   - Empty / null / undefined returns null
//
// Returns the validated path or null if invalid.

export function safeSameOriginPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.length === 0) return null;
  if (!raw.startsWith('/')) return null;
  if (raw.startsWith('//')) return null;
  if (raw.startsWith('/\\')) return null;
  if (raw.includes('://')) return null;
  return raw;
}
