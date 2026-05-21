// Customer portal authentication service.
//
// Wraps the public auth-api endpoint POST /portal/request-signin-link so the
// PortalSignInPage can request a fresh magic-link email for a returning
// customer. The endpoint is anti-leak by design (always 200 with the same
// envelope regardless of whether the email is registered), so the calling
// code treats every non-network result as a success.

import { apiRequest } from '@/lib/apiClient';

export interface RequestSignInLinkResponse {
  ok: boolean;
  message: string;
}

export async function requestPortalSignInLink(
  email: string,
): Promise<RequestSignInLinkResponse> {
  return apiRequest<RequestSignInLinkResponse>(
    '/auth-api/portal/request-signin-link',
    { method: 'POST', body: { email } },
  );
}
