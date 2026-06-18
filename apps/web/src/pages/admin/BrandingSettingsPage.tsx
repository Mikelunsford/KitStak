import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { ColorField } from '@/components/ui/ColorField';
import { ImageUploadField } from '@/components/ui/ImageUploadField';
import { TextInput } from '@/components/ui/TextInput';
import { useAuth } from '@/auth/AuthContext';
import {
  useBrandingAdmin,
  usePatchBranding,
} from '@/lib/hooks/useSettings';
import { HexColorSchema } from '@/lib/types/identity';
import { destructiveConfirm } from '@/lib/destructiveConfirm';
import { useTheme } from '@/whitelabel/ThemeProvider';

/**
 * Kitstak default brand tokens (the constitution palette). Reset restores
 * these and clears every per-org override the form manages.
 */
const KITSTAK_DEFAULTS = {
  appName: '',
  primary: '#0a1628',
  accent: '#c8102e',
  onPrimary: '#f5f1e8',
  logoUrl: '',
  iconUrl: '',
  footer: '',
} as const;

/**
 * Branding admin page.
 *
 * Lets owners and admins edit org_branding. Colors use a native swatch + hex
 * picker (ColorField). Logo and icon upload directly to the public Supabase
 * Storage `branding` bucket via ImageUploadField (signed-URL mint behind the
 * branding.logo.upload capability), with an "or paste a URL" fallback for a
 * hosted asset. The resolved URLs persist through PUT /branding on save.
 *
 * Live preview is wired by writing the color values to the document root
 * as CSS variables. Saved state takes effect immediately because
 * BrandingProvider re-fetches on cache invalidation.
 */
export function BrandingSettingsPage() {
  const { state } = useAuth();
  const enabled = state.status === 'authenticated';
  const query = useBrandingAdmin({ enabled });
  const patch = usePatchBranding();
  const { theme, setTheme } = useTheme();

  const [appName, setAppName] = useState('');
  const [primary, setPrimary] = useState('#0a1628');
  const [accent, setAccent] = useState('#c8102e');
  const [onPrimary, setOnPrimary] = useState('#f5f1e8');
  const [logoUrl, setLogoUrl] = useState('');
  const [iconUrl, setIconUrl] = useState('');
  const [footer, setFooter] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!query.data) return;
    setAppName(query.data.app_name_override ?? '');
    setPrimary(query.data.primary_color);
    setAccent(query.data.accent_color);
    setOnPrimary(query.data.on_primary);
    setLogoUrl(query.data.logo_url ?? '');
    setIconUrl(query.data.icon_url ?? '');
    setFooter(query.data.invoice_pdf_footer ?? '');
  }, [query.data]);

  interface BrandingFormValues {
    appName: string;
    primary: string;
    accent: string;
    onPrimary: string;
    logoUrl: string;
    iconUrl: string;
    footer: string;
  }

  function persist(values: BrandingFormValues) {
    setError(null);
    const primaryParse = HexColorSchema.safeParse(values.primary);
    const accentParse = HexColorSchema.safeParse(values.accent);
    const onPrimaryParse = HexColorSchema.safeParse(values.onPrimary);
    if (!primaryParse.success || !accentParse.success || !onPrimaryParse.success) {
      setError('Colors must be six-digit hex values (with or without #).');
      return;
    }
    patch.mutate(
      {
        app_name_override:
          values.appName.trim() === '' ? null : values.appName.trim(),
        primary_color: values.primary,
        accent_color: values.accent,
        on_primary: values.onPrimary,
        logo_url: values.logoUrl.trim() === '' ? null : values.logoUrl.trim(),
        icon_url: values.iconUrl.trim() === '' ? null : values.iconUrl.trim(),
        invoice_pdf_footer:
          values.footer.trim() === '' ? null : values.footer.trim(),
      },
      {
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : 'Save failed.';
          setError(msg);
        },
      },
    );
  }

  function handleSave() {
    persist({ appName, primary, accent, onPrimary, logoUrl, iconUrl, footer });
  }

  async function handleReset() {
    const confirmed = await destructiveConfirm({
      action: 'Reset branding to Kitstak defaults',
      consequence:
        'This replaces your colors, logo, favicon, workspace name, and PDF footer with the Kitstak defaults and saves immediately.',
    });
    if (!confirmed) return;
    setAppName(KITSTAK_DEFAULTS.appName);
    setPrimary(KITSTAK_DEFAULTS.primary);
    setAccent(KITSTAK_DEFAULTS.accent);
    setOnPrimary(KITSTAK_DEFAULTS.onPrimary);
    setLogoUrl(KITSTAK_DEFAULTS.logoUrl);
    setIconUrl(KITSTAK_DEFAULTS.iconUrl);
    setFooter(KITSTAK_DEFAULTS.footer);
    persist({
      appName: KITSTAK_DEFAULTS.appName,
      primary: KITSTAK_DEFAULTS.primary,
      accent: KITSTAK_DEFAULTS.accent,
      onPrimary: KITSTAK_DEFAULTS.onPrimary,
      logoUrl: KITSTAK_DEFAULTS.logoUrl,
      iconUrl: KITSTAK_DEFAULTS.iconUrl,
      footer: KITSTAK_DEFAULTS.footer,
    });
  }

  return (
    <div className="space-y-8 p-6">
      <header>
        <h1 className="font-display text-3xl text-ink">Branding</h1>
        <p className="font-sans text-sm text-ink-dim">
          Workspace name, colors, logo. Applies to the in-app shell and to
          rendered invoices and quotes.
        </p>
      </header>

      {query.isLoading ? (
        <p className="text-ink-dim">Loading.</p>
      ) : (
        <section className="grid gap-6 md:grid-cols-2">
          <div className="space-y-4">
            <TextInput
              label="App name override"
              name="app_name_override"
              value={appName}
              onChange={(e) => setAppName(e.target.value)}
              placeholder="Kitstak"
            />
            <ColorField
              label="Primary color"
              name="primary_color"
              value={primary}
              onChange={setPrimary}
            />
            <ColorField
              label="Accent color"
              name="accent_color"
              value={accent}
              onChange={setAccent}
            />
            <ColorField
              label="Text on brand color"
              name="on_primary"
              value={onPrimary}
              onChange={setOnPrimary}
            />
            <ImageUploadField
              label="Logo"
              name="logo_url"
              kind="logo"
              value={logoUrl}
              onChange={setLogoUrl}
              hint="Shown in the app shell, on invoices, and on quotes."
            />
            <ImageUploadField
              label="Favicon / icon"
              name="icon_url"
              kind="icon"
              value={iconUrl}
              onChange={setIconUrl}
              hint="Small square mark used as the browser tab icon."
            />
            <TextInput
              label="Invoice PDF footer"
              name="invoice_pdf_footer"
              value={footer}
              onChange={(e) => setFooter(e.target.value)}
            />
          </div>

          <aside className="border border-line p-4">
            <p className="font-sans text-sm uppercase tracking-wide text-ink-dim">
              Live preview
            </p>
            <div
              className="mt-3 flex items-center gap-3 p-4"
              style={{ backgroundColor: primary, color: onPrimary }}
            >
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt="Logo preview"
                  className="h-8 w-auto"
                />
              ) : null}
              <span className="font-display text-2xl">
                {appName || 'Kitstak'}
              </span>
            </div>
            <div
              className="mt-3 inline-block px-4 py-2"
              style={{ backgroundColor: accent, color: onPrimary }}
            >
              Sample CTA
            </div>
          </aside>
        </section>
      )}

      {error ? <p className="text-danger">{error}</p> : null}

      <div className="flex flex-wrap gap-3">
        <Button onClick={handleSave} disabled={patch.isPending}>
          {patch.isPending ? 'Saving.' : 'Save branding'}
        </Button>
        <button
          type="button"
          onClick={() => void handleReset()}
          disabled={patch.isPending}
          className="border border-line px-4 py-2 font-sans text-xs uppercase tracking-wide text-ink-dim transition-colors hover:bg-bg-2 hover:text-ink disabled:opacity-50"
          data-testid="branding-reset"
        >
          Reset to Kitstak defaults
        </button>
      </div>

      <section className="space-y-3 border-t border-line pt-6">
        <div>
          <h2 className="font-display text-2xl text-ink">Appearance</h2>
          <p className="font-sans text-sm text-ink-dim">
            Light or dark interface. This is a personal preference saved to this
            browser only. It does not change your workspace branding for other
            users.
          </p>
        </div>
        <div
          className="inline-flex border border-line"
          role="group"
          aria-label="Interface appearance"
        >
          <button
            type="button"
            onClick={() => setTheme('dark')}
            aria-pressed={theme === 'dark'}
            className={`inline-flex items-center gap-2 px-4 py-2 font-sans text-sm transition-colors ${
              theme === 'dark'
                ? 'bg-accent text-on-primary'
                : 'text-ink-dim hover:bg-bg-2 hover:text-ink'
            }`}
            data-testid="appearance-dark"
          >
            <Moon size={16} aria-hidden="true" />
            Dark
          </button>
          <button
            type="button"
            onClick={() => setTheme('light')}
            aria-pressed={theme === 'light'}
            className={`inline-flex items-center gap-2 px-4 py-2 font-sans text-sm transition-colors ${
              theme === 'light'
                ? 'bg-accent text-on-primary'
                : 'text-ink-dim hover:bg-bg-2 hover:text-ink'
            }`}
            data-testid="appearance-light"
          >
            <Sun size={16} aria-hidden="true" />
            Light
          </button>
        </div>
      </section>
    </div>
  );
}
