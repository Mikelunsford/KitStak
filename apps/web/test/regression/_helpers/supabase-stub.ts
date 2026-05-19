// Active Supabase mock state. The Vitest config replaces the
// `@supabase/supabase-js` esm.sh URL with this module's `createClient`
// re-export so every `admin()` call in the handlers gets a stub.
//
// Tests set `setActiveMockState(state)` before invoking the handler. The
// `createClient` factory returns a client that closes over that state.

import { makeSupabaseMock, type MockState } from './supabase-mock.ts';

let active: MockState | null = null;

export function setActiveMockState(state: MockState): void {
  active = state;
}

export function clearActiveMockState(): void {
  active = null;
}

export function createClient(_url: string, _key: string, _opts?: unknown): unknown {
  if (!active) {
    throw new Error(
      'No active Supabase mock state. Call setActiveMockState(state) before invoking the handler.',
    );
  }
  return makeSupabaseMock(active);
}
