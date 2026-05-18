Kitstak self-hosted font assets.

Place the following woff2 files in this directory to activate the
@font-face declarations in apps/web/src/styles.css:

  BebasNeue-Regular.woff2       - display, regular
  InterTight-Regular.woff2      - body, regular
  InterTight-Medium.woff2       - body, medium
  JetBrainsMono-Regular.woff2   - code, regular

Licensing source:
  - Bebas Neue: SIL Open Font License 1.1 (Dharma Type)
  - Inter Tight: SIL Open Font License 1.1 (Rasmus Andersson)
  - JetBrains Mono: SIL Open Font License 1.1 (JetBrains)

Procurement: download the official woff2 builds from each foundry's
distribution (Google Fonts download, GitHub release, or the publisher's
own site). Do NOT load these from a Google Fonts CDN in production; the
Theme-Pack and constitution mandate self-hosted fonts.

Until the files land the SPA falls through to the system sans/mono stack
per `font-display: swap`. Headlines render as the system sans fallback;
that's acceptable for Wave 1 dev but must be resolved before any
customer demo.

Follow-up: F-Wave1-FONTS-01.
