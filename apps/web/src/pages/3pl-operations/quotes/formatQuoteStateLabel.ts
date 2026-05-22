// PR-6 / B7: extracted from QuoteDetailPage so the vitest unit test
// can exercise the pure formatter without transitively loading the
// supabase singleton (`@/lib/supabase`) at module-load time.
//
// The DB enum keeps the value `submitted` (forward-only migrations),
// but the operator-facing verb is "Sent for approval" in the pre-
// approval phase. Every other state value is rendered with a
// Title-Case cosmetic touch-up (underscores -> spaces).

export function formatQuoteStateLabel(state: string): string {
  if (state === 'submitted') return 'Sent for approval';
  return state
    .split('_')
    .map((part) => (part.length === 0 ? part : part[0]!.toUpperCase() + part.slice(1)))
    .join(' ');
}
