export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'NO_ACTIVE_ORG'
  | 'FORBIDDEN'
  | 'FEATURE_DISABLED'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'STATE_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'VALIDATION_ERROR'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
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
  VALIDATION_ERROR: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, content-type, idempotency-key, x-request-id',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
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
      'x-request-id': requestId,
      ...CORS_HEADERS,
      ...extra,
    },
  });
}

export function ok<T>(data: T, meta?: Record<string, unknown>): Response {
  const body = meta !== undefined ? { data, meta } : { data };
  return withCommonHeaders(200, body);
}

export function created<T>(data: T): Response {
  return withCommonHeaders(201, { data });
}

export function noContent(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
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
