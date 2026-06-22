// SetHomeButton. Per-user default-landing control (Personalization).
//
// Lets the operator pick which surface "/" resolves to after sign-in. Rendered
// in the dashboard and section-home headers. Clicking sets this page as the
// landing; clicking again (when it already is) resets to the dashboard default.
// State is per browser via homeLandingPref; IndexRoute reads it on "/".

import { useState } from 'react';
import { Home } from 'lucide-react';

import {
  DEFAULT_LANDING,
  getHomeLanding,
  setHomeLanding,
} from '@/lib/homeLandingPref';

export function SetHomeButton({ path }: { path: string }) {
  const [home, setHome] = useState<string>(() => getHomeLanding());
  const isHome = home === path;

  const onClick = () => {
    const next = isHome ? DEFAULT_LANDING : path;
    setHomeLanding(next);
    setHome(next);
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isHome}
      title={
        isHome
          ? 'This is your landing page after sign-in. Click to reset to the dashboard.'
          : 'Land here after sign-in.'
      }
      className={`inline-flex shrink-0 items-center gap-1.5 border px-3 py-1.5 font-sans text-xs uppercase tracking-wider transition-colors ${
        isHome
          ? 'border-accent text-ink'
          : 'border-line text-ink-dim hover:border-accent hover:text-ink'
      }`}
      data-testid="set-home-button"
    >
      <Home className="h-3.5 w-3.5" aria-hidden="true" />
      {isHome ? 'Your home' : 'Set as home'}
    </button>
  );
}
