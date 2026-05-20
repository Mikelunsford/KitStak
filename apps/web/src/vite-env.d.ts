/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_APP_ENV: string;
  readonly VITE_APP_URL: string;
  // F-Wave5-CO-02: PostHog analytics (lazy-loaded). When the key is
  // absent the SPA stays in no-op posture. Host defaults to PostHog
  // Cloud US; operator overrides to Cloud EU or self-host via env.
  readonly VITE_POSTHOG_KEY?: string;
  readonly VITE_POSTHOG_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
