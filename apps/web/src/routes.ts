export type RouteSpec = {
  path: string;
  guard?: 'authenticated' | 'public';
};

export const ROUTES: ReadonlyArray<RouteSpec> = [
  { path: '/', guard: 'authenticated' },
  { path: '/sign-in', guard: 'public' },
] as const;
