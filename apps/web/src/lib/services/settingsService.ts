/**
 * Settings service. Wraps settings-api: org_settings CRUD, branding writes,
 * numbering admin. Feature-flag admin lives in flagsService.ts.
 */

import { z } from 'zod';

import { apiRequest } from '@/lib/apiClient';
import {
  BrandingResponseSchema,
  NumberingResetRequestSchema,
  NumberingSequenceSchema,
  OrgSettingSchema,
  SettingUpsertRequestSchema,
  type BrandingResponse,
  type NumberingResetRequest,
  type NumberingSequence,
  type OrgSetting,
  type SettingUpsertRequest,
} from '@/lib/types/identity';

const SettingsListSchema = z.object({
  items: z.array(OrgSettingSchema),
});
const NumberingListSchema = z.object({
  items: z.array(NumberingSequenceSchema),
});

// --- settings ---

export async function listSettings(): Promise<OrgSetting[]> {
  const data = await apiRequest<unknown>('/settings-api/settings', {
    method: 'GET',
  });
  return SettingsListSchema.parse(data).items;
}

export async function listSettingGroup(group: string): Promise<OrgSetting[]> {
  const data = await apiRequest<unknown>(
    `/settings-api/settings/${encodeURIComponent(group)}`,
    { method: 'GET' },
  );
  return SettingsListSchema.parse(data).items;
}

export async function upsertSetting(
  payload: SettingUpsertRequest,
): Promise<OrgSetting> {
  const parsed = SettingUpsertRequestSchema.parse(payload);
  const data = await apiRequest<unknown>('/settings-api/settings', {
    method: 'PUT',
    body: parsed,
  });
  return OrgSettingSchema.parse(data);
}

export async function deleteSetting(
  group: string,
  key: string,
): Promise<void> {
  await apiRequest<unknown>(
    `/settings-api/settings/${encodeURIComponent(group)}/${encodeURIComponent(key)}`,
    { method: 'DELETE' },
  );
}

// --- branding writes ---

export type BrandingPatch = Partial<{
  logo_url: string | null;
  icon_url: string | null;
  email_logo_url: string | null;
  primary_color: string;
  accent_color: string;
  on_primary: string;
  font_family: string;
  invoice_pdf_footer: string | null;
  quote_pdf_footer: string | null;
  app_name_override: string | null;
  support_url: string | null;
  privacy_url: string | null;
  terms_url: string | null;
  custom_css: string | null;
}>;

export async function getBrandingRow(): Promise<BrandingResponse> {
  const data = await apiRequest<unknown>('/settings-api/branding', {
    method: 'GET',
  });
  return BrandingResponseSchema.parse(data);
}

export async function patchBranding(
  patch: BrandingPatch,
): Promise<BrandingResponse> {
  const data = await apiRequest<unknown>('/settings-api/branding', {
    method: 'PUT',
    body: patch,
  });
  return BrandingResponseSchema.parse(data);
}

// --- numbering ---

export async function listNumberingSequences(): Promise<NumberingSequence[]> {
  const data = await apiRequest<unknown>('/settings-api/numbering', {
    method: 'GET',
  });
  return NumberingListSchema.parse(data).items;
}

export async function getNumberingSequence(
  docType: string,
): Promise<NumberingSequence> {
  const data = await apiRequest<unknown>(
    `/settings-api/numbering/${encodeURIComponent(docType)}`,
    { method: 'GET' },
  );
  return NumberingSequenceSchema.parse(data);
}

export async function resetNumberingSequence(
  payload: NumberingResetRequest,
): Promise<{ doc_type: string; next_value: number }> {
  const parsed = NumberingResetRequestSchema.parse(payload);
  const data = await apiRequest<{ doc_type: string; next_value: number }>(
    '/settings-api/numbering/reset',
    { method: 'POST', body: parsed },
  );
  return data;
}
