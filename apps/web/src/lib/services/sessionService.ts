/**
 * Session service. Wraps the auth-api session-switch endpoint and the
 * capability self-read.
 *
 * The /me payload is owned by meService.ts (Wave 1 scaffolding). This file
 * adds the write-side (switch-org) and the capability self-read so callers
 * have one import for the active-session surface.
 */

import { z } from 'zod';

import { apiRequest } from '@/lib/apiClient';
import {
  RoleCodeSchema,
  SwitchOrgRequestSchema,
  SwitchOrgResponseSchema,
  type SwitchOrgRequest,
  type SwitchOrgResponse,
} from '@/lib/types/identity';

export type { SwitchOrgRequest, SwitchOrgResponse };

const CapabilityListSchema = z.object({
  role: RoleCodeSchema,
  capabilities: z.array(z.string()),
});
export type CapabilityList = z.infer<typeof CapabilityListSchema>;

/**
 * POST /auth-api/sessions/switch-org. Stamps the active org claim on the
 * caller's app_metadata and returns the new role binding. The SPA refreshes
 * the JWT after this returns; AuthContext picks up the new claim on the
 * next round-trip.
 */
export async function switchOrg(
  payload: SwitchOrgRequest,
): Promise<SwitchOrgResponse> {
  const parsedInput = SwitchOrgRequestSchema.parse(payload);
  const data = await apiRequest<unknown>('/auth-api/sessions/switch-org', {
    method: 'POST',
    body: parsedInput,
  });
  return SwitchOrgResponseSchema.parse(data);
}

/**
 * GET /auth-api/me/capabilities. Returns the effective identity-capability
 * set for the active role. The SPA caches this for the duration of the
 * session and uses it to hide buttons; the server is authority.
 */
export async function getMyCapabilities(): Promise<CapabilityList> {
  const data = await apiRequest<unknown>('/auth-api/me/capabilities', {
    method: 'GET',
  });
  return CapabilityListSchema.parse(data);
}
