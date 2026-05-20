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
  // F-Wave5-CO-01 / F-Wave3-OBS-01 (SPA portion): Sentry SaaS error
  // and performance capture (lazy-loaded). When the DSN is absent the
  // SPA stays in no-op posture and the @sentry/react chunk is
  // tree-shaken at build. The three sample-rate vars are optional and
  // override the conservative defaults in src/lib/sentry.ts.
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_SENTRY_ENVIRONMENT?: string;
  readonly VITE_SENTRY_TRACES_SAMPLE_RATE?: string;
  readonly VITE_SENTRY_REPLAY_SESSION_SAMPLE_RATE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
