/**
 * Helper for UX-Q10 breadcrumb labels. When a parent entity's display name
 * has not loaded yet (TanStack Query in flight), we still want to render
 * the breadcrumb chain — empty links create a layout jump and degrade the
 * "trail is always visible" promise.
 *
 * `fallbackLabel(loaded, id, prefixLength)` returns the loaded label when
 * it is present, otherwise a short UUID prefix (default 8 chars) as a
 * non-empty placeholder. Mirrors the same fallback pattern used by
 * `EntityLabel` when a list-hook lookup misses (deleted parent, cross-
 * tenant filter, fetch in flight).
 */
export function fallbackLabel(
  loaded: string | null | undefined,
  id: string | null | undefined,
  prefixLength = 8,
): string {
  if (loaded && loaded.length > 0) return loaded;
  if (id && id.length > 0) return id.slice(0, prefixLength);
  return '';
}
