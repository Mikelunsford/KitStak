# design-sync notes (Kitstak UI kit)

Repo-specific gotchas for syncing `apps/web/src/components/ui/` to claude.ai/design.
Append a bullet whenever a new quirk is learned.

## Shape and entry
- This repo is an application (`kitstak-app`, a Vite SPA), not a published component
  library. There is no built `dist/` of the UI kit and no library exports.
- The sync uses a hand-written **barrel entry** (`.design-sync/ds-entry.tsx`) passed
  via `cfg.entry`, plus a full `cfg.componentSrcMap` (all 37 components). Because an
  entry is supplied, `synthEntry` is false, so component discovery comes entirely from
  `componentSrcMap` keys, not auto-detection. Adding a component means adding it to
  BOTH the barrel and `componentSrcMap`.
- `PKG_DIR` resolves to the repo root (walk-up from the barrel finds the root
  `package.json`). `cfg.srcDir`, `componentSrcMap` values, and `cfg.cssEntry` are
  therefore repo-root-relative.

## Backend-coupling stubs (critical)
- `@/lib/apiClient` reads `import.meta.env.VITE_SUPABASE_*` at module load and THROWS
  when they are absent. In an IIFE bundle with no Vite env, that throw poisons the
  whole `window.KitstakUI` assignment — every preview would fail.
- Fix: `.design-sync/ds-tsconfig.json` redirects `@/lib/apiClient`,
  `@/lib/apiClient.core`, `@/lib/supabase`, `@/lib/analytics`, `@/lib/sentry` to
  no-op stubs in `.design-sync/stubs/`. Exact path keys MUST stay before the `@/*`
  wildcard (first matching rule wins, in object order).
- The only files in `src/` using `import.meta.env` are those 5 lib modules (plus
  `main.tsx`/`ErrorBoundary.tsx`, which are not in the UI closure). If a future
  component pulls `import.meta.env` in directly, add a stub or it will break the bundle.

## Data-coupled components (floor / light cards)
- 14 components transitively fetch via the stubbed lib modules and have no live data in
  preview: `CurrencyField`, `ImageUploadField`, `SavedViewsBar`, `BillableLineItemsEditor`,
  and the 10 pickers (`ChannelPicker`, `CustomerPicker`, `InvoicePicker`, `ItemPicker`,
  `PaymentMethodPicker`, `PricingTierPicker`, `ProjectPicker`, `QuotePicker`, `TaxPicker`,
  `VendorPicker`). They import fine (stubs) but render empty/closed states. Author what
  renders statically (e.g. a picker's closed trigger, ImageUploadField's empty dropzone);
  accept floor cards for the rest.
- The other 23 are clean presentational primitives and fully authorable.

## Styling and fonts
- `styles.css` uses `@tailwind` directives, so it CANNOT be `cfg.cssEntry` directly.
  `.design-sync/build-css.mjs` (also `cfg.buildCmd`) compiles it with the app's Tailwind
  config into `.design-sync/.cache/ds-compiled.css` and prepends the Google Fonts
  `@import`. Tailwind v3.4.x classic CLI.
- Brand fonts (Bebas Neue / Inter Tight / JetBrains Mono) load remotely from Google
  Fonts (the app does the same via an index.html `<link>`). Expect `[FONT_REMOTE]`
  (informational), not `[FONT_MISSING]`.
- Design tokens are CSS variables in `styles.css :root` (dark defaults; a
  `:root[data-theme='light']` block exists). The compiled CSS carries them.

## Providers
- `cfg.provider` = `DsPreviewProvider` (exported from the barrel): wraps previews in
  `MemoryRouter` (for `react-router-dom` `Link`/`useSearchParams` in Tabs, StatCard,
  ActionTile, DetailHeader) and a `QueryClientProvider` (for TanStack Query in pickers).

## Build / re-sync commands
- node-modules: `apps/web/node_modules` (where react/react-router/lucide/tanstack resolve).
- Build: `node .ds-sync/package-build.mjs --config .design-sync/config.json --node-modules apps/web/node_modules --entry .design-sync/ds-entry.tsx --out ./ds-bundle`
- (`--entry` is also in `cfg.entry`, so it is optional on the CLI.)

## Hard-won build gotchas (do not regress)
- **ds-tsconfig.json must contain NO comment keys / no `//`.** The tsconfig-paths
  plugin in lib/bundle.mjs strips comments with a naive regex (`[^:]//.*$`); a `"//"`
  key corrupts the JSON, `JSON.parse` throws, the plugin silently returns null, and
  esbuild falls back to the REAL `@/` paths — so the stubs are NOT applied and every
  preview throws "Missing Supabase environment variables". Keep that file pure JSON.
- **ds-tsconfig.json maps ONLY the 5 stub paths, never a `@/*` wildcard.** The plugin
  resolves a matched alias by trying the bare path first, so a wildcard `@/*` returns
  DIRECTORY targets (`@/lib/types`, `@/components/ui/pickers`) as if they were files →
  esbuild "Cannot read file ...: Incorrect function". Letting the 5 exact keys match and
  leaving everything else to esbuild's built-in resolution of `apps/web/tsconfig.json`
  (which does dir→index correctly) is what works.
- **@types/react junction:** dts.mjs derives node_modules from PKG_DIR (repo root) and
  only walks UP, so it can't see `apps/web/node_modules/@types/react` (a child). Root
  `node_modules/@types/react` + `react-dom` are junctions to the apps/web copies; recreate
  on a fresh clone (gitignored) or prop bodies collapse to `[key]: unknown` (`[DTS_REACT]`).
- **Component .d.ts must emit to a NON-dot dir (`ds-dts/`, gitignored).** ts-morph's glob
  skips dot-directories, so emitting under `.design-sync/.cache/` makes the declarations
  invisible and all 37 props go generic. `build-inputs.mjs` emits to `ds-dts/`.
- **Playwright must be 1.59.x** to match the cached chromium build 1217
  (`AppData/Local/ms-playwright/chromium-1217`). 1.60 pins build 1223 and triggers a
  ~120MB download. Installed into `.ds-sync` (ESM `import('playwright')` ignores NODE_PATH,
  so it must resolve from there, not apps/web). Run validate from repo root.

## Known render warns
- Pre-authoring only (expected until previews are authored, then they clear): RENDER_THIN
  on ActionTile/DetailLayout/Disclosure, RENDER_BLANK on TextInput. Not legitimate
  standing warns — if any persist AFTER authoring, investigate.
- tokens: "1 missing" custom property (below threshold, non-blocking).

## Provider and currency stubs (added during preview authoring)
- `DsPreviewProvider` (in `ds-entry.tsx`, set as `cfg.provider`) wraps every preview in
  a navy brand surface (`bg-bg text-ink` + padding) so cream-on-white text is readable,
  plus MemoryRouter and a QueryClientProvider.
- `CurrencyField`'s currency hooks call `useAuth` (needs AuthProvider, absent in
  previews). `@/lib/hooks/useDefaultCurrency` and `@/lib/hooks/useCurrencies` are stubbed
  (`.design-sync/stubs/`) so it renders a real currency select. If another component hits
  a `useAuth must be used inside <AuthProvider>` render error, stub the offending hook the
  same way (preferred over adding a real AuthProvider, which needs a live session).
- cardMode overrides in `cfg.overrides`: DataTable/DetailHeader/DetailLayout/
  BillableLineItemsEditor/ColorField/PageHeader = column (wide); Modal = single
  (overlay, primaryStory ConfirmDelete).
- The 14 data-coupled components (10 pickers + CurrencyField/ImageUploadField/
  SavedViewsBar/BillableLineItemsEditor) render honest closed/empty states (no backend);
  graded good on that basis. ConfirmDialogHost renders nothing until imperatively
  triggered (no prop to force open) — its card is intentionally minimal.

## Re-sync risks
- The stub modules are pinned to the real lib modules' export surface
  (`apiRequest`, `apiRequestWithMeta`, `ApiError`; `supabase`; analytics: `track`,
  `identifyUser`, `resetAnalytics`, `getPostHogFlag`, `onPostHogFlagsLoaded`,
  `bucketCents`; sentry: `captureException`, `identifySentryUser`, `resetSentryUser`).
  If the app changes those exports, esbuild will fail with "No matching export" —
  update the stub to match.
- The barrel + `componentSrcMap` are a manual mirror of `components/ui/`. New or removed
  primitives will not sync until both are updated. Re-derive from
  `ls apps/web/src/components/ui/*.tsx apps/web/src/components/ui/pickers/*.tsx`.
- Tailwind content scan covers all of `apps/web/src`, so the compiled CSS reflects the
  whole app's utility usage — large but complete. Fonts depend on Google Fonts being
  reachable at preview time.
