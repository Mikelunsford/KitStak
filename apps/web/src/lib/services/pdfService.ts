// PDF service. Lists PDF templates and (v1) returns 501 on render.

import { apiRequest } from '@/lib/apiClient';
import { z } from 'zod';

const TemplateSchema = z.object({
  id: z.string(),
  label: z.string(),
  entity_type: z.string(),
});
export type PdfTemplate = z.infer<typeof TemplateSchema>;
const TemplatesSchema = z.object({ items: z.array(TemplateSchema) });

export async function listPdfTemplates(): Promise<PdfTemplate[]> {
  const data = await apiRequest<unknown>('/pdf-worker/pdf/templates', {
    method: 'GET',
  });
  return TemplatesSchema.parse(data).items;
}

export async function renderPdf(
  template: string,
  data: Record<string, unknown>,
): Promise<{ url: string } | { not_available: true; message: string }> {
  try {
    const out = await apiRequest<unknown>('/pdf-worker/pdf/render', {
      method: 'POST',
      body: { template, data },
    });
    return out as { url: string };
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === 'PDF_NOT_YET_AVAILABLE') {
      return {
        not_available: true,
        message: e.message ?? 'PDF rendering is not yet available.',
      };
    }
    throw err;
  }
}
