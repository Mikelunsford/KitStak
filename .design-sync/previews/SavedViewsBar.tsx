import { SavedViewsBar } from 'kitstak-ui';

// SavedViewsBar reads stored presets from the saved_views feature (useSavedViews
// hook). That backend is stubbed empty in the preview environment, so this
// renders the empty state: no saved chips, just the "Save view" affordance.
export function EmptyForQuotes() {
  return (
    <SavedViewsBar
      entityType="quote"
      currentConfig={{ search: '', sort: 'created_at:desc', status: 'sent' }}
      onApply={() => {}}
    />
  );
}
