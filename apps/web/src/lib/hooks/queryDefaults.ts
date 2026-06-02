// Shared TanStack Query option defaults.
//
// These mirror the QueryClient-level defaults configured once in main.tsx
// (staleTime 30_000, refetchOnWindowFocus false, retry 1) per
// 00-canon/01-architecture.md "State management". The QueryClient default
// already governs every useQuery call, so spreading QUERY_DEFAULTS is a
// consistency aid, not a behavior change. Hooks that need a different stale
// window spread this first and then override `staleTime`:
//
//   useQuery({ queryKey, queryFn, ...QUERY_DEFAULTS, staleTime: 5 * 60_000 });
//
// Keep this object in sync with the QueryClient defaultOptions in main.tsx.
export const QUERY_DEFAULTS = {
  staleTime: 30_000,
  refetchOnWindowFocus: false,
  retry: 1,
} as const;
