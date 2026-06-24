import { ImageUploadField } from 'kitstak-ui';

// ImageUploadField uploads through uploadBrandingAsset (signed-URL mint plus
// direct storage upload). That service is stubbed in the preview environment,
// so these render the empty dropzone state only. Uploading would require a live
// storage backend.
export function CompanyLogo() {
  return (
    <ImageUploadField
      label="Company logo"
      kind="logo"
      value=""
      onChange={() => {}}
      hint="Shown on quotes, invoices, and the customer portal."
    />
  );
}

export function Favicon() {
  return (
    <ImageUploadField
      label="Favicon"
      kind="icon"
      value=""
      onChange={() => {}}
      hint="Square image works best. PNG or ICO."
    />
  );
}
