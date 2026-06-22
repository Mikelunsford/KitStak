// CustomizableSection. Renders a section dashboard's widgets in the user's
// chosen order and visibility (Personalization, Phase A2), and hosts the
// "Customize" mode where each widget can be hidden/shown and moved up/down.
//
// Layout is per-user and cross-device, read/written via useDashboardPrefs /
// useSetDashboardPref (dashboard-api, migration 0128). Outside Customize mode
// we render the live server layout; inside it we render a local draft seeded on
// entry, persisting each edit so a refetch never disrupts the in-progress edit.
//
// Reorder is up/down buttons rather than drag: accessible by keyboard, no new
// dependency (the constitution forbids adding one), and robust. Drag could be a
// later enhancement layered on the same layout helpers.

import { useState, type ReactNode } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  SlidersHorizontal,
} from 'lucide-react';

import type {
  DashboardSectionKey,
  DashboardSectionLayout,
} from '@/lib/types/cross_cutting';
import {
  useDashboardPrefs,
  useSetDashboardPref,
} from '@/lib/hooks/useCrossCutting';
import {
  isWidgetHidden,
  moveWidget,
  sortWidgets,
  toggleWidgetHidden,
  visibleWidgets,
} from './dashboardLayout';

export interface DashboardWidget {
  id: string;
  title: string;
  node: ReactNode;
}

function HubSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-16 animate-pulse border border-line bg-bg-2" />
      ))}
    </div>
  );
}

function CustomizeButton({
  customizing,
  onClick,
}: {
  customizing: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={customizing}
      className={`inline-flex shrink-0 items-center gap-1.5 border px-3 py-1.5 font-sans text-xs uppercase tracking-wider transition-colors ${
        customizing
          ? 'border-accent text-ink'
          : 'border-line text-ink-dim hover:border-accent hover:text-ink'
      }`}
      data-testid="customize-toggle"
    >
      <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
      {customizing ? 'Done' : 'Customize'}
    </button>
  );
}

function WidgetFrame({
  widget,
  hidden,
  isFirst,
  isLast,
  onToggle,
  onMove,
}: {
  widget: DashboardWidget;
  hidden: boolean;
  isFirst: boolean;
  isLast: boolean;
  onToggle: () => void;
  onMove: (direction: 'up' | 'down') => void;
}) {
  return (
    <div className="border border-dashed border-accent/60">
      <div className="flex items-center justify-between gap-3 border-b border-dashed border-accent/40 bg-bg-2 px-3 py-2">
        <span className="flex items-center gap-2 font-sans text-xs uppercase tracking-wider text-ink-dim">
          {widget.title}
          {hidden ? (
            <span className="border border-line px-1.5 py-0.5 text-[10px] text-ink-dim">
              Hidden
            </span>
          ) : null}
        </span>
        <span className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onMove('up')}
            disabled={isFirst}
            aria-label={`Move ${widget.title} up`}
            className="border border-line p-1 text-ink-dim hover:text-ink disabled:opacity-30"
          >
            <ChevronUp className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onMove('down')}
            disabled={isLast}
            aria-label={`Move ${widget.title} down`}
            className="border border-line p-1 text-ink-dim hover:text-ink disabled:opacity-30"
          >
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onToggle}
            aria-label={hidden ? `Show ${widget.title}` : `Hide ${widget.title}`}
            className="border border-line p-1 text-ink-dim hover:text-ink"
          >
            {hidden ? (
              <EyeOff className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Eye className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </span>
      </div>
      <div className={`p-3 ${hidden ? 'opacity-40' : ''}`}>{widget.node}</div>
    </div>
  );
}

export function CustomizableSection({
  sectionKey,
  widgets,
  loadingHub = false,
}: {
  sectionKey: DashboardSectionKey;
  widgets: DashboardWidget[];
  loadingHub?: boolean;
}) {
  const prefs = useDashboardPrefs();
  const setPref = useSetDashboardPref();
  const [customizing, setCustomizing] = useState(false);
  const [draft, setDraft] = useState<DashboardSectionLayout>({});

  const serverLayout = prefs.data?.sections[sectionKey];
  const layout = customizing ? draft : serverLayout;

  const canCustomize = !loadingHub && widgets.length > 0;

  const toggleCustomize = () => {
    if (customizing) {
      setCustomizing(false);
      return;
    }
    setDraft(serverLayout ?? {});
    setCustomizing(true);
  };

  const persist = (next: DashboardSectionLayout) => {
    setDraft(next);
    setPref.mutate({ section_key: sectionKey, config: next });
  };

  // In Customize mode show every widget (so hidden ones can be restored); the
  // ordered id list spans all widgets so up/down moves are unambiguous.
  const ordered = sortWidgets(widgets, layout);
  const shown = customizing ? ordered : visibleWidgets(widgets, layout);

  return (
    <div className="flex flex-col gap-6">
      {canCustomize ? (
        <div className="flex justify-end">
          <CustomizeButton customizing={customizing} onClick={toggleCustomize} />
        </div>
      ) : null}

      {shown.length === 0 && !loadingHub ? (
        <p className="font-sans text-sm text-ink-dim">
          Everything here is hidden. Use Customize to bring widgets back.
        </p>
      ) : (
        <div className="flex flex-col gap-8">
          {shown.map((w, i) =>
            customizing ? (
              <WidgetFrame
                key={w.id}
                widget={w}
                hidden={isWidgetHidden(layout, w.id)}
                isFirst={i === 0}
                isLast={i === shown.length - 1}
                onToggle={() => persist(toggleWidgetHidden(layout, w.id))}
                onMove={(dir) =>
                  persist(
                    moveWidget(
                      layout,
                      ordered.map((x) => x.id),
                      w.id,
                      dir,
                    ),
                  )
                }
              />
            ) : (
              <div key={w.id}>{w.node}</div>
            ),
          )}
        </div>
      )}

      {loadingHub ? <HubSkeleton /> : null}
    </div>
  );
}
