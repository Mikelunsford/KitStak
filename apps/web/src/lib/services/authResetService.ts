// Password-reset service. Thin wrapper over the public auth-api endpoint
// POST /auth/request-password-reset.
//
// F-Wave9-INVITE-PASSWORD-SETUP-01 (SPA half). The endpoint is anti-leak by
// design (always 200 with the same envelope regardless of whether the email
// resolves to an auth.users row), so the calling code treats every non-
// network result as a generic success and renders the same confirmation
// message in every case. The response schema is the byte-mirrored shape
// from @/lib/types/identity; a wire-shape drift surfaces as a Zod parse
// error at this boundary rather than as a silent any-cast deeper in the
// SPA.

import { apiRequest } from '@/lib/apiClient';
import {
  RequestPasswordResetResponseSchema,
  type RequestPasswordResetRequest,
  type RequestPasswordResetResponse,
} from '@/lib/types/identity';

export async function requestPasswordReset(
  body: RequestPasswordResetRequest,
): Promise<RequestPasswordResetResponse> {
  const data = await apiRequest<unknown>(
    '/auth-api/auth/request-password-reset',
    { method: 'POST', body },
  );
  return RequestPasswordResetResponseSchema.parse(data);
}
