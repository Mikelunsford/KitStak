// Date and date-string formatters used across the SPA.
//
// All formatters accept either a Date or an ISO-8601 string. Returns "." for
// null / undefined / invalid input so callers can drop the result inline
// without conditional rendering.

export function formatDateMedium(input: Date | string | null | undefined): string {
  if (input === null || input === undefined || input === '') return '.';
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return '.';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(d);
}

export function formatDateShort(input: Date | string | null | undefined): string {
  if (input === null || input === undefined || input === '') return '.';
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return '.';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(d);
}
