import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';
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
 * Lets owners and admins edit org_branding. Logo and icon upload to the
 * Supabase Storage `attachments` bucket is a follow-up; today the form
 * accepts URLs directly so an operator can paste a hosted asset.
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
  const [logoUrl, setLogoUrl] = useState('');
  const [iconUrl, setIconUrl] = useState('');
  const [footer, setFooter] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!query.data) return;
    setAppName(query.data.app_name_override ?? '');
    setPrimary(query.data.primary_color);
    setAccent(query.data.accent_color);
    setLogoUrl(query.data.logo_url ?? '');
    setIconUrl(query.data.icon_url ?? '');
    setFooter(query.data.invoice_pdf_footer ?? '');
  }, [query.data]);

  function handleSave() {
    setError(null);
    const primaryParse = HexColorSchema.safeParse(primary);
    const accentParse = HexColorSchema.safeParse(accent);
    if (!primaryParse.success || !accentParse.success) {
      setError('Colors must be six-digit hex values (with or without #).');
      return;
    }
    patch.mutate(
      {
        app_name_override: appName.trim() === '' ? null : appName.trim(),
        primary_color: primary,
        accent_color: accent,
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
            <TextInput
              label="Primary color"
              name="primary_color"
              value={primary}
              onChange={(e) => setPrimary(e.target.value)}
              placeholder="#0a1628"
            />
            <TextInput
              label="Accent color"
              name="accent_color"
              value={accent}
              onChange={(e) => setAccent(e.target.value)}
              placeholder="#c8102e"
            />
            <TextInput
              label="Logo URL"
              name="logo_url"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
            />
            <TextInput
              label="Favicon / icon URL"
              name="icon_url"
              value={iconUrl}
              onChange={(e) => setIconUrl(e.target.value)}
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
              style={{ backgroundColor: primary, color: '#f5f1e8' }}
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
              style={{ backgroundColor: accent, color: '#f5f1e8' }}
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
