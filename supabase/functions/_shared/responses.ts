import { corsHeaders } from './cors.ts';
import { HTTP_HEADERS } from './constants.ts';

export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'NO_ACTIVE_ORG'
  | 'FORBIDDEN'
  | 'FEATURE_DISABLED'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'STATE_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'BILLING_REQUIRED'
  | (string & { _brand?: 'forwardCode' });

const STATUS_FOR_CODE: Record<string, number> = {
  UNAUTHORIZED: 401,
  NO_ACTIVE_ORG: 401,
  FORBIDDEN: 403,
  FEATURE_DISABLED: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  STATE_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  // BAD_REQUEST (400) is the path-param / shape-of-request validation rail.
  // VALIDATION_ERROR (422) is reserved for body-schema validation per the
  // existing handler-helpers convention. The constitution lists both as
  // distinct constitutional 4xx codes.
  BAD_REQUEST: 400,
  VALIDATION_ERROR: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  // BILLING_REQUIRED (403) is the paid-plugin entitlement rail: enabling a
  // paid pillar plugin without an active subscription is denied on the
  // settings flag-write surface. Distinct from the bundle gate (404).
  BILLING_REQUIRED: 403,
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown> | undefined;

  constructor(
    code: ApiErrorCode,
    statusOrMessage?: number | string,
    message?: string,
    details?: Record<string, unknown>,
  ) {
    const resolvedStatus =
      typeof statusOrMessage === 'number'
        ? statusOrMessage
        : STATUS_FOR_CODE[code] ?? 500;
    const resolvedMessage =
      typeof statusOrMessage === 'string'
        ? statusOrMessage
        : (message ?? code);
    super(resolvedMessage);
    this.code = code;
    this.status = resolvedStatus;
    if (details !== undefined) this.details = details;
  }
}

/**
 * Build an opaque 500 from an internal failure (D2, F-Wave10-REVIEW-REMEDIATION).
 *
 * The real error (a Postgres/Postgrest error, a thrown Error, or any raw
 * value) is logged server-side with its log context so operators can still
 * trace it in the function logs. The returned ApiError carries a fixed,
 * non-leaking message so the wire response never echoes database internals,
 * column names, constraint text, or stack detail to the caller.
 *
 * Usage keeps the existing `throw` site shape:
 *   if (error) throw internalError('saved_views.insert', error);
 *
 * Only use for true internal faults. Do NOT route 4xx validation errors
 * through this helper: those messages are intentional, caller-facing, and
 * must stay specific.
 */
export function internalError(
  logContext: string,
  rawErr: unknown,
): ApiError {
  const detail =
    rawErr instanceof Error
      ? rawErr.message
      : typeof rawErr === 'string'
        ? rawErr
        : (() => {
            try {
              return JSON.stringify(rawErr);
            } catch {
              return String(rawErr);
            }
          })();
  console.error('internal_error', { context: logContext, detail });
  return new ApiError('INTERNAL_ERROR', 500, 'An internal error occurred.');
}

function withCommonHeaders(
  status: number,
  body: unknown,
  extra: Record<string, string> = {},
): Response {
  const requestId = crypto.randomUUID();
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      [HTTP_HEADERS.X_REQUEST_ID]: requestId,
      ...corsHeaders(),
      ...extra,
    },
  });
}

export function ok<T>(data: T, meta?: Record<string, unknown>): Response {
  const body = meta !== undefined ? { data, meta } : { data };
  return withCommonHeaders(200, body);
}

export function noContent(): Response {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export function fromApiError(error: ApiError): Response {
  return withCommonHeaders(error.status, {
    error: {
      code: error.code,
      message: error.message,
      details: error.details,
    },
  });
}
