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

function applyBranding(branding: Branding | null): void {
  const root = document.documentElement;
  if (!branding) {
    // Wipe overrides so platform defaults from styles.css :root take effect.
    root.style.removeProperty('--brand');
    root.style.removeProperty('--accent');
    root.style.removeProperty('--ink');
    root.style.removeProperty('--font-sans');
    document.title = 'Kitstak';
    return;
  }
  const primary = hexToRgbTriplet(branding.primary_color);
  const accent = hexToRgbTriplet(branding.accent_color);
  const ink = hexToRgbTriplet(branding.on_primary);
  if (primary) {
    root.style.setProperty('--bg', primary);
    root.style.setProperty('--brand', primary);
  }
  if (accent) root.style.setProperty('--accent', accent);
  if (ink) root.style.setProperty('--ink', ink);
  root.style.setProperty('--font-sans', branding.font_family);

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
  const isAuthed = state.status === 'authenticated';
  const query = useBrandingQuery({ enabled: isAuthed });
  const [internal, setInternal] = useState<BrandingState>(DEFAULT_STATE);

  useEffect(() => {
    if (!isAuthed) {
      applyBranding(null);
      setInternal(DEFAULT_STATE);
      return;
    }
    if (query.isLoading) {
      setInternal((prev) => ({ ...prev, status: 'loading' }));
      return;
    }
    if (query.data) {
      applyBranding(query.data);
      setInternal({ branding: query.data, status: 'loaded' });
      return;
    }
    // No data and not loading. fail-open to defaults so the surface is
    // usable even when the branding endpoint is offline (Wave 1).
    applyBranding(null);
    setInternal({ branding: null, status: 'loaded' });
  }, [isAuthed, query.isLoading, query.data]);

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
