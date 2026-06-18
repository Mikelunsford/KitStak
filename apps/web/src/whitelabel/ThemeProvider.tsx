import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * ThemeProvider. owns the per-user light/dark appearance preference.
 *
 * The Kitstak default chrome is dark (navy surfaces, cream ink), so the
 * toggle's real job is offering a light alternative. The choice is a per-user
 * browser preference, persisted to localStorage, NOT an org branding setting.
 * It writes `data-theme` to <html>; the surface tokens in styles.css switch on
 * that attribute, and BrandingProvider reads the active theme so an org's
 * primary colour stops repainting the page background in light mode.
 *
 * The context default is non-throwing (dark + noops) so components can call
 * useTheme() in isolation (tests, storybook) without a provider.
 */

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'kitstak.theme';
const DEFAULT_THEME: Theme = 'dark';

interface ThemeState {
  theme: Theme;
  setTheme: (next: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeState>({
  theme: DEFAULT_THEME,
  setTheme: () => {},
  toggle: () => {},
});

function readInitialTheme(): Theme {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' ? stored : DEFAULT_THEME;
  } catch {
    // Private-mode / blocked storage: fall back to the brand default.
    return DEFAULT_THEME;
  }
}

function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readInitialTheme);

  // Apply on mount and whenever the choice changes. The very first paint is the
  // app's "Loading." fallback, so a light user sees at most one frame of the
  // dark default before this runs.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEY, next);
      }
    } catch {
      // Persistence is best-effort; the in-memory choice still applies.
    }
  }, []);

  const toggle = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  const value = useMemo<ThemeState>(
    () => ({ theme, setTheme, toggle }),
    [theme, setTheme, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  return useContext(ThemeContext);
}
