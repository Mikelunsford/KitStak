/**
 * Admin-console service. Wraps admin-console-api routes.
 *
 * The bundle is gated behind `platform_admin.enabled`. When the flag is
 * off, every endpoint returns 404 NOT_FOUND. Callers should treat 404 as
 * "feature disabled" and hide the surface, NOT redirect to the dashboard.
 *
 * Wave 2 ships a stub: list returns an empty page, impersonate returns
 * 501 NOT_IMPLEMENTED, audit returns an empty page.
 */

import { z } from 'zod';

import { apiRequest } from '@/lib/apiClient';

const PageSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), next_cursor: z.string().nullable() });

export async function listPlatformOrgs(): Promise<{
  items: unknown[];
  next_cursor: string | null;
}> {
  const data = await apiRequest<unknown>('/admin-console-api/orgs', {
    method: 'GET',
  });
  return PageSchema(z.unknown()).parse(data);
}

export async function readPlatformAuditPage(): Promise<{
  items: unknown[];
  next_cursor: string | null;
}> {
  const data = await apiRequest<unknown>('/admin-console-api/audit', {
    method: 'GET',
  });
  return PageSchema(z.unknown()).parse(data);
}
