// design-sync stub for @/lib/apiClient.
// The real module reads import.meta.env.VITE_SUPABASE_* at module load and
// throws when they are absent, which would poison the whole _ds_bundle.js IIFE.
// In the preview/design environment there is no backend, so data calls resolve
// to empty results and data-bound components fall back to their floor cards.
export class ApiError extends Error {}

export async function apiRequest<T = unknown>(): Promise<T> {
  return [] as unknown as T;
}

export async function apiRequestWithMeta<T = unknown>(): Promise<{ data: T; meta: Record<string, unknown> }> {
  return { data: [] as unknown as T, meta: {} };
}
