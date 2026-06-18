import { useEffect, useState } from 'react';

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

  function handleSave() {
    setError(null);
    const primaryParse = HexColorSchema.safeParse(primary);
    const accentParse = HexColorSchema.safeParse(accent);
    const onPrimaryParse = HexColorSchema.safeParse(onPrimary);
    if (!primaryParse.success || !accentParse.success || !onPrimaryParse.success) {
      setError('Colors must be six-digit hex values (with or without #).');
      return;
    }
    patch.mutate(
      {
        app_name_override: appName.trim() === '' ? null : appName.trim(),
        primary_color: primary,
        accent_color: accent,
        on_primary: onPrimary,
        logo_url: logoUrl.trim() === '' ? null : logoUrl.trim(),
        icon_url: iconUrl.trim() === '' ? null : iconUrl.trim(),
        invoice_pdf_footer: footer.trim() === '' ? null : footer.trim(),
      },
      {
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : 'Save failed.';
          setError(msg);
        },
      },
    );
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

      <div className="flex gap-3">
        <Button onClick={handleSave} disabled={patch.isPending}>
          {patch.isPending ? 'Saving.' : 'Save branding'}
        </Button>
      </div>
    </div>
  );
}
