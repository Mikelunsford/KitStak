import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { useAuth } from '@/auth/AuthContext';
import { useBranding as useBrandingQuery } from '@/lib/hooks/useBranding';
import { useTheme, type Theme } from '@/whitelabel/ThemeProvider';
import type { Branding } from '@/lib/services/brandingService';

/**
 * BrandingProvider. applies the active org's brand tokens to the SPA at
 * runtime. Reads the active org's branding row via `useBranding()` (which
 * wraps `GET /tenants-api/branding`), converts each hex string to the
 * `r g b` triplet that the CSS-variable system in styles.css consumes,
 * and writes the result to `document.documentElement.style`.
 *
 * Also updates `document.title` from `app_name_override` and swaps the
 * favicon when a tenant icon is configured. Falls back to the Kitstak
 * defaults when unauthenticated or when the endpoint is offline (Wave 1).
 *
 * The default app-name fallback is "Kitstak" per REBRAND-MAP § 8. never
 * a previous tenant's name.
 */

type BrandingState = {
  branding: Branding | null;
  status: 'default' | 'loaded' | 'loading';
};

const DEFAULT_STATE: BrandingState = {
  branding: null,
  status: 'default',
};

const BrandingContext = createContext<BrandingState | undefined>(undefined);

function hexToRgbTriplet(hex: string): string | null {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!m || !m[1]) return null;
  const raw = m[1];
  const full =
    raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

function applyBranding(branding: Branding | null, theme: Theme): void {
  const root = document.documentElement;
  if (!branding) {
    // Wipe overrides so platform defaults from styles.css :root (and the
    // light-theme block) take effect.
    root.style.removeProperty('--bg');
    root.style.removeProperty('--brand');
    root.style.removeProperty('--accent');
    root.style.removeProperty('--ink');
    root.style.removeProperty('--on-primary');
    root.style.removeProperty('--font-sans');
    document.title = 'Kitstak';
    return;
  }
  const primary = hexToRgbTriplet(branding.primary_color);
  const accent = hexToRgbTriplet(branding.accent_color);
  const onPrimary = hexToRgbTriplet(branding.on_primary);

  // Brand chrome and CTA colours apply in both themes.
  if (primary) root.style.setProperty('--brand', primary);
  if (accent) root.style.setProperty('--accent', accent);
  if (onPrimary) root.style.setProperty('--on-primary', onPrimary);
  root.style.setProperty('--font-sans', branding.font_family);

  // Page surfaces: in dark mode the org primary repaints the background and
  // its on_primary becomes the page ink (the established behaviour). In light
  // mode we step back and let the light palette in styles.css own the
  // surfaces, otherwise an org's navy primary would defeat light mode.
  if (theme === 'dark') {
    if (primary) root.style.setProperty('--bg', primary);
    if (onPrimary) root.style.setProperty('--ink', onPrimary);
  } else {
    root.style.removeProperty('--bg');
    root.style.removeProperty('--ink');
  }

  document.title = branding.app_name_override ?? 'Kitstak';

  const favHref = branding.icon_url ?? branding.logo_url;
  if (favHref) {
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = favHref;
  }
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const { theme } = useTheme();
  const isAuthed = state.status === 'authenticated';
  const query = useBrandingQuery({ enabled: isAuthed });
  const [internal, setInternal] = useState<BrandingState>(DEFAULT_STATE);

  // `theme` is a dependency so flipping appearance re-applies the palette: in
  // light mode we must release the org's --bg / --ink overrides; in dark mode
  // we must re-assert them.
  useEffect(() => {
    if (!isAuthed) {
      applyBranding(null, theme);
      setInternal(DEFAULT_STATE);
      return;
    }
    if (query.isLoading) {
      setInternal((prev) => ({ ...prev, status: 'loading' }));
      return;
    }
    if (query.data) {
      applyBranding(query.data, theme);
      setInternal({ branding: query.data, status: 'loaded' });
      return;
    }
    // No data and not loading. fail-open to defaults so the surface is
    // usable even when the branding endpoint is offline (Wave 1).
    applyBranding(null, theme);
    setInternal({ branding: null, status: 'loaded' });
  }, [isAuthed, query.isLoading, query.data, theme]);

  const value = useMemo<BrandingState>(() => internal, [internal]);

  return (
    <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>
  );
}

export function useBrandingContext(): BrandingState {
  const ctx = useContext(BrandingContext);
  if (!ctx) {
    throw new Error('useBrandingContext must be used inside <BrandingProvider>');
  }
  return ctx;
}
