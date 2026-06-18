// ImageUploadField. A labelled branding-asset control: drag-and-drop or click
// to upload an image (logo / favicon / email logo), with a live thumbnail
// preview and an "or paste a URL" text fallback so the prior URL flow still
// works. Controlled: the parent owns the resolved URL string. Uploads go
// through uploadBrandingAsset (signed-URL mint + direct storage upload); the
// parent persists the URL via PUT /branding on save. Tailwind brand tokens
// only; lucide-react for the affordance icon.

import { useRef, useState, type ReactElement } from 'react';
import { ImageIcon, Upload } from 'lucide-react';

import { uploadBrandingAsset } from '@/lib/services/brandingUpload';
import type { BrandingAssetKind } from '@/lib/types/identity';

export interface ImageUploadFieldProps {
  label?: string;
  name?: string;
  /** Which branding column the asset is destined for (drives the size cap). */
  kind: BrandingAssetKind;
  /** Current resolved URL (uploaded public URL or a pasted URL). */
  value: string;
  onChange: (url: string) => void;
  hint?: string;
}

const FILE_ACCEPT = 'image/png,image/jpeg,image/svg+xml,image/webp,image/x-icon';

export function ImageUploadField({
  label,
  name,
  kind,
  value,
  onChange,
  hint,
}: ImageUploadFieldProps): ReactElement {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  async function handleFile(file: File | undefined): Promise<void> {
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const { url } = await uploadBrandingAsset(kind, file);
      onChange(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {label && (
        <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
          {label}
        </span>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void handleFile(e.dataTransfer.files?.[0]);
        }}
        className={`flex items-center gap-4 border border-dashed p-4 transition-colors ${
          dragging ? 'border-accent bg-bg-3' : 'border-line bg-bg-2'
        }`}
      >
        {value ? (
          <img
            src={value}
            alt={`${label ?? kind} preview`}
            className="h-12 w-12 shrink-0 object-contain"
          />
        ) : (
          <div className="grid h-12 w-12 shrink-0 place-items-center border border-line text-ink-faint">
            <ImageIcon size={20} aria-hidden="true" />
          </div>
        )}

        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="inline-flex w-fit items-center gap-2 bg-bg-3 px-3 py-2 font-sans text-sm text-ink transition-colors hover:bg-line disabled:opacity-50"
          >
            <Upload size={16} aria-hidden="true" />
            {uploading ? 'Uploading.' : value ? 'Replace image' : 'Upload image'}
          </button>
          <span className="font-sans text-xs text-ink-dim">
            Drag and drop, or click to choose. PNG, JPEG, SVG, WebP, ICO.
          </span>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={FILE_ACCEPT}
          className="hidden"
          onChange={(e) => void handleFile(e.target.files?.[0])}
        />
      </div>

      <input
        type="text"
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="or paste an image URL"
        className="bg-bg-2 border border-line text-ink px-4 py-3 font-sans text-sm focus:outline-none focus:border-accent"
      />

      {hint && <span className="font-sans text-xs text-ink-dim">{hint}</span>}
      {error && <span className="font-sans text-sm text-danger">{error}</span>}
    </div>
  );
}
