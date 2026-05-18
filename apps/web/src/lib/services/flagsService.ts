/**
 * Feature-flag admin service. Wraps settings-api/flags routes.
 */

import { z } from 'zod';

import { apiRequest } from '@/lib/apiClient';
import {
  OrgFeatureFlagSchema,
  type OrgFeatureFlag,
} from '@/lib/types/identity';

const FlagsListSchema = z.object({
  items: z.array(OrgFeatureFlagSchema),
});

export async function listFeatureFlags(): Promise<OrgFeatureFlag[]> {
  const data = await apiRequest<unknown>('/settings-api/flags', {
    method: 'GET',
  });
  return FlagsListSchema.parse(data).items;
}

export interface FlagUpsertInput {
  flag_key: string;
  is_enabled: boolean;
  config?: Record<string, unknown>;
}

export async function upsertFeatureFlag(
  input: FlagUpsertInput,
): Promise<OrgFeatureFlag> {
  const { flag_key, is_enabled, config } = input;
  const data = await apiRequest<unknown>(
    `/settings-api/flags/${encodeURIComponent(flag_key)}`,
    {
      method: 'PUT',
      body: { is_enabled, config: config ?? {} },
    },
  );
  return OrgFeatureFlagSchema.parse(data);
}
