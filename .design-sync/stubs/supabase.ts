// design-sync stub for @/lib/supabase.
// A self-returning, non-thenable proxy: any property access or call returns
// another proxy, so chained calls like supabase.auth.getSession() and
// supabase.from('x').select() never throw and never hang on await.
const make = (): any =>
  new Proxy(() => make(), {
    get: (_t, p) => (p === 'then' ? undefined : make()),
    apply: () => make(),
  });

export const supabase: any = make();
