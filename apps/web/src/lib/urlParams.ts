// F-Wave9-AUDIT-V3-WAVE-C3-01: shared URL query-param guards used by the
// create pages that accept deep-link prefill. Centralised so the validation
// rules (UUID shape, defence-in-depth against non-string inputs) live in
// one place rather than being copy-pasted per page.
//
// Receiving already had a local copy at
// `apps/web/src/pages/3pl-operations/receiving/receivingProjectParam.ts`
// which now re-exports from here so existing imports keep working.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate a `?project_id=` query-param value before binding it to a
 * picker or sending it to the API. Returns the value when it parses as
 * a canonical UUID, otherwise null. A null return keeps the picker
 * empty and prevents a malformed deep-link URL from poisoning the
 * create form or generating a 422 on submit.
 */
export function parseProjectIdParam(v: string | null | undefined): string | null {
  if (typeof v !== 'string') return null;
  return UUID_RE.test(v) ? v : null;
}
