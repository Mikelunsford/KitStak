import { z } from 'zod';

import { supabase } from '@/lib/supabase';
import { ERROR_CODES, HTTP_HEADERS } from '@/lib/constants';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Missing Supabase environment variables');
}

const FUNCTIONS_BASE = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1`;

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
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const method = options.method ?? 'GET';

  const { data: { session } } = await supabase.auth.getSession();
  const bearer = session?.access_token ?? SUPABASE_ANON_KEY;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    [HTTP_HEADERS.API_KEY]: SUPABASE_ANON_KEY,
    [HTTP_HEADERS.AUTHORIZATION]: `Bearer ${bearer}`,
    ...options.headers,
  };
  if (method !== 'GET') {
    headers[HTTP_HEADERS.IDEMPOTENCY_KEY] = crypto.randomUUID();
  }

  const url = path.startsWith('http')
    ? path
    : `${FUNCTIONS_BASE}${path.startsWith('/') ? '' : '/'}${path}`;

  const init: RequestInit = { method, headers };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);
  const response = await fetch(url, init);

  const requestId = response.headers.get(HTTP_HEADERS.X_REQUEST_ID) ?? undefined;
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
      ERROR_CODES.INTERNAL_ERROR,
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
