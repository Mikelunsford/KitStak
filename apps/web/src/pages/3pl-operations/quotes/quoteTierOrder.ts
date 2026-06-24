// ADR 0004: pure reorder helper for the tier panel. Given the current ordered
// tier ids, move one tier up (-1) or down (1) by a single slot. Returns a NEW
// array, and returns the order unchanged when the move would fall off either end
// or the tier id is not present.
export function moveTierOrder(
  orderedIds: readonly string[],
  tierId: string,
  dir: -1 | 1,
): string[] {
  const idx = orderedIds.indexOf(tierId);
  const swap = idx + dir;
  if (idx < 0 || swap < 0 || swap >= orderedIds.length) {
    return [...orderedIds];
  }
  const next = [...orderedIds];
  const a = next[idx];
  const b = next[swap];
  if (a === undefined || b === undefined) return [...orderedIds];
  next[idx] = b;
  next[swap] = a;
  return next;
}
