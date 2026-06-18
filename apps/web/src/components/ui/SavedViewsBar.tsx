// SavedViewsBar. The saved-views control for the list toolbar (Workstream C of
// the 2026-06-17 UI scan). Saving and loading filter/sort presets is fully
// backed by the existing saved_views feature (table + RLS since migration 0034,
// collaboration-api CRUD, the savedViewsService and useCrossCutting hooks); this
// is the toolbar-facing UI that stores the current view config and applies a
// saved one back.
//
// The view config is whatever useServerList.viewConfig produces (search, sort,
// facets), stored in saved_views.config (jsonb). entityType keys the list so a
// quote view never shows on the invoice list.

import { useState, type FormEvent } from 'react';
import { Bookmark, X } from 'lucide-react';

import { Button } from './Button';
import {
  useSavedViews,
  useCreateSavedView,
  useDeleteSavedView,
} from '@/lib/hooks/useCrossCutting';

export interface SavedViewsBarProps {
  /** Saved-view scope key (e.g. 'quote', 'invoice'). */
  entityType: string;
  /** The current toolbar state to store when the operator saves a view. */
  currentConfig: Record<string, unknown>;
  /** Apply a stored view config back onto the toolbar. */
  onApply: (config: Record<string, unknown>) => void;
}

export function SavedViewsBar({ entityType, currentConfig, onApply }: SavedViewsBarProps) {
  const views = useSavedViews(entityType);
  const createView = useCreateSavedView();
  const deleteView = useDeleteSavedView(entityType);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  const saved = views.data ?? [];

  function onSave(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    createView.mutate(
      { entity_type: entityType, name: trimmed, config: currentConfig, is_shared: false },
      {
        onSuccess: () => {
          setName('');
          setNaming(false);
        },
      },
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {saved.map((v) => (
        <span
          key={v.id}
          className="inline-flex items-center gap-1 border border-line bg-bg-2 px-2 py-1 font-sans text-xs text-ink-dim"
        >
          <button type="button" onClick={() => onApply(v.config)} className="hover:text-ink">
            {v.name}
          </button>
          <button
            type="button"
            onClick={() => deleteView.mutate(v.id)}
            aria-label={`Delete saved view ${v.name}`}
            className="hover:text-accent"
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        </span>
      ))}

      {naming ? (
        <form onSubmit={onSave} className="inline-flex items-center gap-2">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="View name"
            aria-label="Saved view name"
            className="border border-line bg-bg-2 px-2 py-1 font-sans text-xs text-ink"
          />
          <Button type="submit" variant="secondary" disabled={createView.isPending || !name.trim()}>
            {createView.isPending ? 'Saving.' : 'Save'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setNaming(false);
              setName('');
            }}
          >
            Cancel
          </Button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setNaming(true)}
          className="inline-flex items-center gap-1 font-sans text-xs text-accent hover:text-accent-bright"
        >
          <Bookmark className="h-3.5 w-3.5" aria-hidden="true" />
          Save view
        </button>
      )}

      {createView.isError ? (
        <span className="font-sans text-xs text-accent">Could not save the view.</span>
      ) : null}
    </div>
  );
}
