// Shared helpers for the vendors-api bundle.
// All handlers route through requireCaller -> requireCap -> admin().
//
// The per-bundle requireVioCap shim was retired at F-Wave2-AGENT-A-05.
// Handlers now import requireCap from _shared/handler-helpers.ts directly
// via the re-export below.

import { ApiError, ok, internalError } from '../_shared/responses.ts';
import { admin, parseLimit, decodeCursor, paginate, parseBody, parseUuidParam, respondWithIdempotency, created, requireCap } from '../_shared/handler-helpers.ts';
import { requireCaller, type Caller } from '../_shared/tenant.ts';
import { listOrgScoped, getByIdOrgScoped } from '../_shared/crud.ts';
import {
  canTransitionVio,
  type Fsm,
} from '../_shared/workflow/vendors_inventory_ops.ts';

export {
  ApiError, ok, admin, parseLimit, decodeCursor, paginate, parseBody,
  parseUuidParam, respondWithIdempotency, created, requireCaller, requireCap,
  internalError,
  // E6: relocated to _shared/crud.ts; re-exported so the vendors-api bundle
  // keeps its existing import surface unchanged.
  listOrgScoped, getByIdOrgScoped,
};
export type { Caller };

/**
 * Guarded state transition. Throws STATE_CONFLICT 409 when the FSM does not
 * declare from -> to. The DB CHECK is the second backstop.
 */
export function assertTransition<S extends string>(
  fsm: Fsm<S>,
  from: S,
  to: S,
): void {
  if (!canTransitionVio(fsm, from, to)) {
    throw new ApiError(
      'STATE_CONFLICT',
      409,
      `illegal ${fsm.entity} transition: ${from} -> ${to}`,
    );
  }
}
