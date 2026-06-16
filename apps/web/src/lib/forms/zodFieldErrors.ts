// R-W13-UX-03(b): map Zod safeParse issues to per-field form errors.
//
// The repo form pattern is `useState` + `FormSchema.safeParse(draft)`. Several
// pages already hand-roll a per-field map (e.g. WarehouseCreatePage walks
// `parsed.error.issues` and indexes by `issue.path[0]`), while others collapse
// every issue into a single banner string with
// `issues.map((i) => i.message).join('; ')` (e.g. the original
// ChartOfAccountCreatePage). The banner form makes the operator hunt for which
// field is wrong; the per-field form puts the message on the offending input.
//
// This helper canonicalizes the per-field mapping so forms stop re-deriving it
// inline and so the field-error shape stays consistent across the SPA.

import type { ZodError } from 'zod';

/**
 * A per-field error map keyed by the form's field names. The value is the first
 * Zod issue message for that field (form fields surface a single line, so we
 * keep the first issue and ignore later duplicates on the same path).
 */
export type FieldErrors<K extends string = string> = Partial<Record<K, string>>;

/**
 * Reduce a `ZodError` into a `{ field: message }` map keyed by the top-level
 * field name (`issue.path[0]`). The first issue per field wins. Issues with an
 * empty path (whole-object refinements) are collected under the `_form` key so
 * the caller can still surface a form-level message if it wants one.
 *
 * @example
 *   const parsed = FormSchema.safeParse(draft);
 *   if (!parsed.success) {
 *     setErrors(zodIssuesToFieldErrors(parsed.error));
 *     return;
 *   }
 */
export function zodIssuesToFieldErrors<K extends string = string>(
  error: ZodError,
): FieldErrors<K> {
  const fieldErrors: FieldErrors<K> = {};
  for (const issue of error.issues) {
    const head = issue.path[0];
    const key = (
      head === undefined || head === null ? '_form' : String(head)
    ) as K;
    // First issue per field wins: a field can accumulate several issues
    // (e.g. min-length then regex) but a single input renders one line.
    if (fieldErrors[key] === undefined) {
      fieldErrors[key] = issue.message;
    }
  }
  return fieldErrors;
}
