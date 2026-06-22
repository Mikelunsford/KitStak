// dashboardLayout. Pure helpers for applying a per-user DashboardSectionLayout
// (Personalization) to a section's widget list: ordering, visibility, and the
// edit operations the Customize mode performs (toggle hidden, move up/down).
//
// Kept React-free so it can be unit-tested without jsdom, matching the
// sectionDashboardFormat pattern. The layout shape is the canon
// DashboardSectionLayout: { widgets: { <id>: { hidden?, order? } }, ... }.
// pinned_views (and any future key) is preserved through every edit.

import type { DashboardSectionLayout } from '@/lib/types/cross_cutting';

export interface OrderableWidget {
  id: string;
}

export function isWidgetHidden(
  layout: DashboardSectionLayout | undefined,
  id: string,
): boolean {
  return layout?.widgets?.[id]?.hidden === true;
}

/**
 * Stable-sort widgets by their stored order, falling back to registry order
 * (the array index) for any widget without one. JS sort is stable, so ties
 * keep registry order. A widget never stored is therefore exactly where the
 * code placed it until the user reorders.
 */
export function sortWidgets<T extends OrderableWidget>(
  widgets: ReadonlyArray<T>,
  layout: DashboardSectionLayout | undefined,
): T[] {
  return widgets
    .map((w, i) => ({ w, order: layout?.widgets?.[w.id]?.order ?? i, i }))
    .sort((a, b) => a.order - b.order || a.i - b.i)
    .map((x) => x.w);
}

/** The visible subset, in order. Used outside Customize mode. */
export function visibleWidgets<T extends OrderableWidget>(
  widgets: ReadonlyArray<T>,
  layout: DashboardSectionLayout | undefined,
): T[] {
  return sortWidgets(widgets, layout).filter((w) => !isWidgetHidden(layout, w.id));
}

/** Flip a widget's hidden flag, returning a new layout (immutable). */
export function toggleWidgetHidden(
  layout: DashboardSectionLayout | undefined,
  id: string,
): DashboardSectionLayout {
  const widgets = { ...(layout?.widgets ?? {}) };
  const cur = widgets[id] ?? {};
  widgets[id] = { ...cur, hidden: !(cur.hidden === true) };
  return { ...(layout ?? {}), widgets };
}

/**
 * Move a widget one slot up or down within `orderedIds` (the full, already
 * ordered id list including hidden widgets), normalizing every widget's order
 * to its new index so the result is unambiguous. No-op at the boundary.
 */
export function moveWidget(
  layout: DashboardSectionLayout | undefined,
  orderedIds: ReadonlyArray<string>,
  id: string,
  direction: 'up' | 'down',
): DashboardSectionLayout {
  const idx = orderedIds.indexOf(id);
  if (idx === -1) return layout ?? {};
  const target = direction === 'up' ? idx - 1 : idx + 1;
  if (target < 0 || target >= orderedIds.length) return layout ?? {};

  const next = [...orderedIds];
  const moved = next[idx];
  const displaced = next[target];
  // Both indices were bounds-checked above; this guard only narrows the types
  // under noUncheckedIndexedAccess.
  if (moved === undefined || displaced === undefined) return layout ?? {};
  next[idx] = displaced;
  next[target] = moved;

  const widgets = { ...(layout?.widgets ?? {}) };
  next.forEach((wid, i) => {
    widgets[wid] = { ...(widgets[wid] ?? {}), order: i };
  });
  return { ...(layout ?? {}), widgets };
}
