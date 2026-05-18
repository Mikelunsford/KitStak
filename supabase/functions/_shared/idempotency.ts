import { ApiError, ok } from './responses.ts';

type SupabaseLike = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, value: string) => {
        eq: (col: string, value: string) => {
          eq: (col: string, value: string) => {
            eq: (col: string, value: string) => {
              maybeSingle: () => Promise<{
                data: IdempotencyRow | null;
                error: unknown;
              }>;
            };
          };
        };
      };
    };
    insert: (row: IdempotencyRow) => Promise<{ error: unknown }>;
  };
};

type IdempotencyRow = {
  key: string;
  user_id: string;
  org_id: string;
  route_hash: string;
  body_hash: string;
  status_code: number;
  response_jsonb: unknown;
};

type Context = {
  client: SupabaseLike;
  key: string;
  userId: string;
  orgId: string;
  route: string;
  body: unknown;
};

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return (
    '{' +
    keys
      .map(
        (k) =>
          JSON.stringify(k) +
          ':' +
          canonicalize((value as Record<string, unknown>)[k]),
      )
      .join(',') +
    '}'
  );
}

export async function respondWithIdempotency(
  ctx: Context,
  handler: () => Promise<Response>,
): Promise<Response> {
  const routeHash = await sha256Hex(ctx.route);
  const bodyHash = await sha256Hex(canonicalize(ctx.body));

  const lookup = await ctx.client
    .from('idempotency_keys')
    .select('*')
    .eq('key', ctx.key)
    .eq('user_id', ctx.userId)
    .eq('org_id', ctx.orgId)
    .eq('route_hash', routeHash)
    .maybeSingle();

  const existing = lookup.data;
  if (existing) {
    if (existing.body_hash !== bodyHash) {
      throw new ApiError(
        'IDEMPOTENCY_CONFLICT',
        'Idempotency key already used with a different request body.',
      );
    }
    return ok(existing.response_jsonb);
  }

  const response = await handler();
  const cloned = response.clone();
  const text = await cloned.text();
  const parsed = (() => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  })();

  await ctx.client.from('idempotency_keys').insert({
    key: ctx.key,
    user_id: ctx.userId,
    org_id: ctx.orgId,
    route_hash: routeHash,
    body_hash: bodyHash,
    status_code: response.status,
    response_jsonb: parsed,
  });

  return response;
}
