// Exports service. The endpoint returns a CSV stream; we build the URL and
// hand it to window.location for download. No JSON parsing happens here.

import type { ExportEntityType } from '@/lib/types/cross_cutting';

export function exportUrl(entityType: ExportEntityType): string {
  return `/exports-api/exports/${encodeURIComponent(entityType)}?format=csv`;
}

export function triggerExport(entityType: ExportEntityType): void {
  if (typeof window === 'undefined') return;
  window.location.assign(exportUrl(entityType));
}
