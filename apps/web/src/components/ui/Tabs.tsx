// Tabs. Hand-rolled, dependency-free tablist (no Radix or headless lib, per the
// constitution). Implements the WAI-ARIA tabs pattern: roving tabindex, arrow /
// Home / End keyboard nav with automatic activation, and full role / aria-*
// wiring. The active tab is synced to a URL search param (replace history) so
// tabs are deep-linkable and back-button friendly. Only the active panel is
// rendered.
//
// The pure resolution helpers are exported and unit-tested separately because
// the component itself uses hooks (the repo tests components by element-tree
// walk, which cannot call a hook-using function directly).

import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';

export interface TabSpec {
  /** Stable key; reflected in the URL search param and the ARIA ids. */
  key: string;
  /** Visible tab label. */
  label: string;
  /** Panel content, rendered only while the tab is active. */
  panel: ReactNode;
}

export interface TabsProps {
  tabs: ReadonlyArray<TabSpec>;
  /** Accessible name for the tablist (required). */
  'aria-label': string;
  /** URL search-param key the active tab syncs to. Default 'tab'. */
  paramKey?: string;
  /** Active tab when the param is missing or unknown. Default the first tab. */
  defaultKey?: string;
}

/**
 * Resolve the active tab key: the URL param if it names a real tab, else the
 * provided default if real, else the first tab. Pure.
 */
export function resolveActiveTabKey(
  tabKeys: ReadonlyArray<string>,
  paramValue: string | null,
  defaultKey?: string,
): string {
  if (paramValue && tabKeys.includes(paramValue)) return paramValue;
  if (defaultKey && tabKeys.includes(defaultKey)) return defaultKey;
  return tabKeys[0] ?? '';
}

/**
 * Map an arrow / Home / End key to the next tab index (wrapping for arrows), or
 * null for any other key. Pure.
 */
export function nextTabIndex(
  key: string,
  currentIndex: number,
  length: number,
): number | null {
  if (length === 0) return null;
  switch (key) {
    case 'ArrowRight':
      return (currentIndex + 1) % length;
    case 'ArrowLeft':
      return (currentIndex - 1 + length) % length;
    case 'Home':
      return 0;
    case 'End':
      return length - 1;
    default:
      return null;
  }
}

export function Tabs({
  tabs,
  'aria-label': ariaLabel,
  paramKey = 'tab',
  defaultKey,
}: TabsProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const activeKey = resolveActiveTabKey(
    tabs.map((t) => t.key),
    searchParams.get(paramKey),
    defaultKey,
  );

  const selectTab = (key: string) => {
    const next = new URLSearchParams(searchParams);
    next.set(paramKey, key);
    setSearchParams(next, { replace: true });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = nextTabIndex(event.key, index, tabs.length);
    if (next === null) return;
    event.preventDefault();
    const nextTab = tabs[next];
    if (!nextTab) return;
    selectTab(nextTab.key);
    tabRefs.current[next]?.focus();
  };

  if (tabs.length === 0) return null;

  const activePanel = tabs.find((t) => t.key === activeKey)?.panel ?? null;

  return (
    <div>
      <div
        role="tablist"
        aria-label={ariaLabel}
        className="flex flex-wrap gap-1 border-b border-line"
      >
        {tabs.map((tab, index) => {
          const selected = tab.key === activeKey;
          return (
            <button
              key={tab.key}
              ref={(el) => {
                tabRefs.current[index] = el;
              }}
              type="button"
              role="tab"
              id={`tab-${tab.key}`}
              aria-selected={selected}
              aria-controls={`panel-${tab.key}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => selectTab(tab.key)}
              onKeyDown={(e) => onKeyDown(e, index)}
              className={
                'px-4 py-2 font-display text-sm tracking-wider uppercase focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ' +
                (selected
                  ? 'border-b-2 border-accent text-ink'
                  : 'border-b-2 border-transparent text-ink-dim hover:text-ink')
              }
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`panel-${activeKey}`}
        aria-labelledby={`tab-${activeKey}`}
        tabIndex={0}
        className="pt-6 focus:outline-none"
      >
        {activePanel}
      </div>
    </div>
  );
}
