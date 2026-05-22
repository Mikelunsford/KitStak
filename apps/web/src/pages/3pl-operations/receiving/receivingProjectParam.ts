// UX-Q6: shared UUID guard for the `?project_id=` query param. Lifted into
// a standalone module so it can be unit-tested without rendering the page.
// Mirrors PR #103's parseEntityTypeParam validation approach — fall back
// to null on malformed input instead of binding garbage to the picker or
// sending it to the API.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseProjectIdParam(v: string | null | undefined): string | null {
  if (typeof v !== 'string') return null;
  return UUID_RE.test(v) ? v : null;
}
