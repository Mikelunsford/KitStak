// Pin the pure dashboard-layout helpers (Personalization Customize mode).

import { describe, it, expect } from 'vitest';

import type { DashboardSectionLayout } from '@/lib/types/cross_cutting';
import {
  isWidgetHidden,
  moveWidget,
  sortWidgets,
  toggleWidgetHidden,
  visibleWidgets,
} from './dashboardLayout';

const W = [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as const;

describe('sortWidgets', () => {
  it('keeps registry order when no layout is stored', () => {
    expect(sortWidgets(W, undefined).map((w) => w.id)).toEqual(['a', 'b', 'c']);
    expect(sortWidgets(W, {}).map((w) => w.id)).toEqual(['a', 'b', 'c']);
  });

  it('honors stored order', () => {
    const layout: DashboardSectionLayout = {
      widgets: { a: { order: 2 }, b: { order: 0 }, c: { order: 1 } },
    };
    expect(sortWidgets(W, layout).map((w) => w.id)).toEqual(['b', 'c', 'a']);
  });

  it('tie-breaks order collisions by registry index', () => {
    // 'c' is pinned to 0, but 'a' also falls back to registry index 0. On the
    // tie the stable sort keeps registry order, so a precedes c, then b (index
    // 1). This mixed state is transient: any reorder normalizes every order.
    const layout: DashboardSectionLayout = { widgets: { c: { order: 0 } } };
    expect(sortWidgets(W, layout).map((w) => w.id)).toEqual(['a', 'c', 'b']);
  });
});

describe('isWidgetHidden / visibleWidgets', () => {
  it('reports and filters hidden widgets', () => {
    const layout: DashboardSectionLayout = { widgets: { b: { hidden: true } } };
    expect(isWidgetHidden(layout, 'b')).toBe(true);
    expect(isWidgetHidden(layout, 'a')).toBe(false);
    expect(visibleWidgets(W, layout).map((w) => w.id)).toEqual(['a', 'c']);
  });
});

describe('toggleWidgetHidden', () => {
  it('flips hidden and preserves other widgets and keys', () => {
    const layout: DashboardSectionLayout = {
      widgets: { a: { order: 0 } },
      pinned_views: [{ saved_view_id: 'v1' }],
    };
    const next = toggleWidgetHidden(layout, 'b');
    expect(next.widgets?.b?.hidden).toBe(true);
    expect(next.widgets?.a?.order).toBe(0);
    expect(next.pinned_views).toEqual([{ saved_view_id: 'v1' }]);
    // Idempotent toggle back to visible.
    expect(toggleWidgetHidden(next, 'b').widgets?.b?.hidden).toBe(false);
  });

  it('does not mutate the input', () => {
    const layout: DashboardSectionLayout = { widgets: { a: {} } };
    const next = toggleWidgetHidden(layout, 'a');
    expect(next).not.toBe(layout);
    expect(layout.widgets?.a?.hidden).toBeUndefined();
  });
});

describe('moveWidget', () => {
  const ids = ['a', 'b', 'c'];

  it('moves down and normalizes every order', () => {
    const next = moveWidget(undefined, ids, 'a', 'down');
    expect(sortWidgets(W, next).map((w) => w.id)).toEqual(['b', 'a', 'c']);
    expect(next.widgets?.a?.order).toBe(1);
    expect(next.widgets?.b?.order).toBe(0);
    expect(next.widgets?.c?.order).toBe(2);
  });

  it('moves up', () => {
    const next = moveWidget(undefined, ids, 'c', 'up');
    expect(sortWidgets(W, next).map((w) => w.id)).toEqual(['a', 'c', 'b']);
  });

  it('is a no-op at the boundary', () => {
    expect(moveWidget(undefined, ids, 'a', 'up')).toEqual({});
    expect(moveWidget(undefined, ids, 'c', 'down')).toEqual({});
  });

  it('preserves hidden flags and pinned_views', () => {
    const layout: DashboardSectionLayout = {
      widgets: { b: { hidden: true } },
      pinned_views: [{ saved_view_id: 'v1', order: 0 }],
    };
    const next = moveWidget(layout, ids, 'a', 'down');
    expect(next.widgets?.b?.hidden).toBe(true);
    expect(next.pinned_views).toEqual([{ saved_view_id: 'v1', order: 0 }]);
  });
});
