import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { useAuth } from './auth';

type Branding = {
  primary_color: string;
  accent_color: string;
  on_primary: string;
  font_family: string;
  logo_url: string | null;
  icon_url: string | null;
  app_name_override: string | null;
};

const DEFAULT_BRANDING: Branding = {
  primary_color: '#0a1628',
  accent_color: '#c8102e',
  on_primary: '#f5f1e8',
  font_family: 'Inter Tight',
  logo_url: null,
  icon_url: null,
  app_name_override: null,
};

type BrandingState = {
  branding: Branding;
  status: 'default' | 'loaded' | 'loading';
};

const BrandingContext = createContext<BrandingState | null>(null);

function hexToRgbTriplet(hex: string): string | null {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!m || !m[1]) return null;
  const raw = m[1];
  const full = raw.length === 3
    ? raw.split('').map((c) => c + c).join('')
    : raw;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

function applyBrandingToRoot(branding: Branding): void {
  const root = document.documentElement;
  const primary = hexToRgbTriplet(branding.primary_color);
  const accent  = hexToRgbTriplet(branding.accent_color);
  const ink     = hexToRgbTriplet(branding.on_primary);
  if (primary) {
    root.style.setProperty('--bg', primary);
    root.style.setProperty('--brand', primary);
  }
  if (accent) {
    root.style.setProperty('--accent', accent);
  }
  if (ink) {
    root.style.setProperty('--ink', ink);
  }
  root.style.setProperty('--font-sans', branding.font_family);
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const { user, status: authStatus } = useAuth();
  const [state, setState] = useState<BrandingState>({
    branding: DEFAULT_BRANDING,
    status: 'default',
  });

  useEffect(() => {
    if (authStatus !== 'authenticated' || !user) {
      applyBrandingToRoot(DEFAULT_BRANDING);
      setState({ branding: DEFAULT_BRANDING, status: 'default' });
      return;
    }

    let cancelled = false;
    setState((prev) => ({ ...prev, status: 'loading' }));

    (async () => {
      const { data, error } = await supabase
        .from('org_branding')
        .select(
          'primary_color, accent_color, on_primary, font_family, logo_url, icon_url, app_name_override',
        )
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        applyBrandingToRoot(DEFAULT_BRANDING);
        setState({ branding: DEFAULT_BRANDING, status: 'loaded' });
        return;
      }
      const branding: Branding = {
        primary_color: data.primary_color ?? DEFAULT_BRANDING.primary_color,
        accent_color:  data.accent_color  ?? DEFAULT_BRANDING.accent_color,
        on_primary:    data.on_primary    ?? DEFAULT_BRANDING.on_primary,
        font_family:   data.font_family   ?? DEFAULT_BRANDING.font_family,
        logo_url:      data.logo_url      ?? null,
        icon_url:      data.icon_url      ?? null,
        app_name_override: data.app_name_override ?? null,
      };
      applyBrandingToRoot(branding);
      setState({ branding, status: 'loaded' });
    })();

    return () => {
      cancelled = true;
    };
  }, [authStatus, user]);

  return (
    <BrandingContext.Provider value={state}>{children}</BrandingContext.Provider>
  );
}

export function useBranding(): BrandingState {
  const ctx = useContext(BrandingContext);
  if (!ctx) throw new Error('useBranding must be used inside BrandingProvider');
  return ctx;
}
