// Password-reset hooks. TanStack Query wrapper over authResetService.
//
// F-Wave9-INVITE-PASSWORD-SETUP-01 (SPA half). The mutation has no cache
// to invalidate; success is a fire-and-forget queued email. Callers render
// the same confirmation message on success and on network error (the
// service still throws on network errors, but the SignInPage forgot-password
// affordance shows the generic "if an account exists" message in both
// branches to preserve the anti-enumeration posture even when the request
// genuinely fails between browser and edge).

import { useMutation } from '@tanstack/react-query';

import { requestPasswordReset } from '@/lib/services/authResetService';
import type {
  RequestPasswordResetRequest,
  RequestPasswordResetResponse,
} from '@/lib/types/identity';

export function useRequestPasswordReset() {
  return useMutation<
    RequestPasswordResetResponse,
    Error,
    RequestPasswordResetRequest
  >({
    mutationFn: requestPasswordReset,
  });
}
