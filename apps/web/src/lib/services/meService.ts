/**
 * Identity service. Wraps `auth-api/me` in a typed call.
 *
 * Wave 1 stub: the auth-api edge function ships in Wave 2 (Agent A). The
 * shape declared here matches what the Wave 2 contract will return so
 * downstream consumers (Topbar, AuthContext, useCapabilities) can be
 * written against it now and become live the moment the endpoint deploys.
 *
 * For Wave 1 the function is exported but the React Query hook
 * (`useMe`) ships with `enabled: false` by default so no network call
 * fires.
 */

import { z } from 'zod';

import { apiRequest } from '@/lib/apiClient';
import { RoleCodeSchema, UuidSchema } from '@/lib/types';

export const MembershipSchema = z.object({
  org_id: UuidSchema,
  display_name: z.string(),
  role: RoleCodeSchema,
});
export type Membership = z.infer<typeof MembershipSchema>;

export const MeSchema = z.object({
  user_id: UuidSchema,
  email: z.string().email(),
  display_name: z.string().nullable(),
  active_org_id: UuidSchema.nullable(),
  active_role: RoleCodeSchema.nullable(),
  memberships: z.array(MembershipSchema),
});
export type Me = z.infer<typeof MeSchema>;

/**
 * GET /auth-api/me. Resolves the active org/role from JWT claim with a
 * sole-membership fallback on the server.
 */
export async function getMe(): Promise<Me> {
  const data = await apiRequest<unknown>('/auth-api/me', { method: 'GET' });
  return MeSchema.parse(data);
}
