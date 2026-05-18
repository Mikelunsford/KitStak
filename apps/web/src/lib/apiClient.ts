import { z } from 'zod';

const EnvelopeSchema = z.object({
  data: z.unknown(),
  meta: z.record(z.unknown()).optional(),
});

const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
    request_id: z.string().optional(),
  }),
});

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Record<string, unknown> | undefined;
  readonly requestId?: string | undefined;

  constructor(
    code: string,
    status: number,
    message: string,
    details?: Record<string, unknown>,
    requestId?: string,
  ) {
    super(message);
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
    if (requestId !== undefined) this.requestId = requestId;
  }
}

type ApiRequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
};

export async function apiRequest<T>(
  url: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers,
  };
  if (method !== 'GET') {
    headers['Idempotency-Key'] = crypto.randomUUID();
  }

  const init: RequestInit = { method, headers };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);
  const response = await fetch(url, init);

  const requestId = response.headers.get('x-request-id') ?? undefined;
  const json = (await response.json()) as unknown;

  if (!response.ok) {
    const parsed = ErrorEnvelopeSchema.safeParse(json);
    if (parsed.success) {
      const detailsArg =
        parsed.data.error.details !== undefined ? parsed.data.error.details : undefined;
      const requestIdArg = parsed.data.error.request_id ?? requestId;
      throw new ApiError(
        parsed.data.error.code,
        response.status,
        parsed.data.error.message,
        detailsArg,
        requestIdArg,
      );
    }
    throw new ApiError(
      'INTERNAL_ERROR',
      response.status,
      'Unexpected error',
      undefined,
      requestId,
    );
  }

  const parsed = EnvelopeSchema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError('INVALID_ENVELOPE', 500, 'Invalid response envelope');
  }
  return parsed.data.data as T;
}
