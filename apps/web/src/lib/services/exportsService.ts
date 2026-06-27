// Exports service. The exports-api endpoint streams a CSV body but is guarded by
// requireCaller + requireCap('exports.job.create'), so it must be reached with
// an authenticated request. R-W15-EXPORT-01: the previous window.location.assign
// of a relative path both missed the function host (no /exports-api rewrite, so
// the SPA 404'd) and could not attach the bearer header (so the guard 401'd).
// We now fetch the CSV through the authenticated apiClient and download the Blob.

import { apiRequestBlob } from '@/lib/apiClient';
import type { ExportEntityType } from '@/lib/types/cross_cutting';

export function exportPath(entityType: ExportEntityType): string {
  return `/exports-api/exports/${encodeURIComponent(entityType)}?format=csv`;
}

export async function triggerExport(entityType: ExportEntityType): Promise<void> {
  if (typeof window === 'undefined') return;
  const blob = await apiRequestBlob(exportPath(entityType));
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = `${entityType}-export.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
