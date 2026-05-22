// PR-F: pure helper extracted from ItemPicker so the vitest unit test
// can pin the (id, item) emission contract without rendering the
// picker. Lives in its own module because importing from `ItemPicker`
// transitively loads the supabase singleton (apiClient → supabase.ts),
// and the repo convention is to test picker logic via a pure module
// (see `LineItemsEditor.test.ts` header).

import type { Item } from '@/lib/types/sales';

/**
 * Given the items the picker currently has loaded and the raw <select>
 * value the user just chose, return the (id, item) pair that
 * ItemPicker emits via its onChange.
 *
 * - Empty string (placeholder option) clears the value: returns
 *   `{ id: null, item: undefined }`.
 * - A matching id returns the resolved Item alongside the id so
 *   callers can pre-fill dependent fields synchronously.
 * - An id with no match (defensive — shouldn't happen since the
 *   options come from this same list) returns the id with
 *   `item: undefined` so callers can decide what to do.
 */
export function pickItemFromList(
  items: readonly Item[],
  rawValue: string,
): { id: string | null; item: Item | undefined } {
  if (rawValue === '') return { id: null, item: undefined };
  const item = items.find((i) => i.id === rawValue);
  return { id: rawValue, item };
}
