// Deno runtime shim for Vitest.
//
// The Kitstak edge functions are authored against Deno. To exercise their
// HTTP-level behaviour under Vitest (Node), we install a global shim that:
//   1. captures `Deno.serve(handler)` so the test harness can invoke the
//      handler directly with a `Request` rather than spinning up a server.
//   2. supplies `Deno.env.get` with a fixed bag of env vars so the
//      service-role client factory in `_shared/handler-helpers.ts` does not
//      throw INTERNAL_ERROR.
//
// The shim is installed lazily on first import. Tests call
// `installDenoShim()` in a `beforeAll` (or top-level) hook, then dynamically
// `await import(handlerPath)` to register the captured handler.

interface CapturedServer {
  handler: ((req: Request) => Promise<Response> | Response) | null;
}

const state: CapturedServer = { handler: null };

const FAKE_ENV: Record<string, string> = {
  SUPABASE_URL: 'http://localhost:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'fake-service-role-key',
  WORKER_SECRET: 'test-worker-secret',
  STRIPE_SECRET_KEY: 'sk_test_fake',
  STRIPE_WEBHOOK_SECRET: 'whsec_test_fake',
};

interface DenoLike {
  serve: (handler: (req: Request) => Promise<Response> | Response) => void;
  env: { get: (key: string) => string | undefined };
}

declare global {
  var Deno: DenoLike | undefined;
}

export function installDenoShim(): void {
  if (globalThis.Deno) return;
  const shim: DenoLike = {
    serve: (handler) => {
      state.handler = handler;
    },
    env: {
      get: (key) => FAKE_ENV[key],
    },
  };
  globalThis.Deno = shim;
}

export function capturedHandler(): (req: Request) => Promise<Response> | Response {
  if (!state.handler) {
    throw new Error('Deno.serve handler was not captured. Did the module import succeed?');
  }
  return state.handler;
}

export function resetCapturedHandler(): void {
  state.handler = null;
}
