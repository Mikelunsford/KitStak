/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Surfaces resolve through CSS variables so BrandingProvider's runtime
        // injection and the light/dark theme switch can repaint without a
        // rebuild. Defaults (and the light-theme overrides) live in
        // styles.css :root and :root[data-theme='light'].
        bg: {
          DEFAULT: 'rgb(var(--bg) / <alpha-value>)',
          2: 'rgb(var(--bg-2) / <alpha-value>)',
          3: 'rgb(var(--bg-3) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--ink) / <alpha-value>)',
          dim: 'rgb(var(--ink-dim) / <alpha-value>)',
          faint: 'rgb(var(--ink-faint) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          bright: 'rgb(var(--accent-bright) / <alpha-value>)',
          soft: 'rgba(200, 16, 46, 0.1)',
        },
        // Text colour for accent / brand fills. Cream in both themes.
        on: {
          primary: 'rgb(var(--on-primary) / <alpha-value>)',
        },
        line: {
          DEFAULT: 'rgb(var(--line) / <alpha-value>)',
          strong: 'rgb(var(--line-strong) / <alpha-value>)',
        },
        success: '#2ecc71',
        warning: '#f39c12',
        danger: '#c8102e',
        info: '#3498db',
      },
      fontFamily: {
        display: ['Bebas Neue', 'system-ui', 'sans-serif'],
        sans: ['var(--font-sans)', 'Inter Tight', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      spacing: {
        18: '4.5rem',
        22: '5.5rem',
      },
      // Fully flat and sharp: every radius scale is 0 (including pills,
      // capsules, and rounded-full) so no rounded shapes appear anywhere. The
      // signature constraint of the KitStak design system.
      borderRadius: {
        none: '0',
        sm: '0',
        DEFAULT: '0',
        md: '0',
        lg: '0',
        xl: '0',
        '2xl': '0',
        '3xl': '0',
        full: '0',
      },
      // No drop shadows anywhere: depth comes from borders and surface tint,
      // never elevation. Focus rings use the separate ring-* utility and are
      // unaffected.
      boxShadow: {
        none: 'none',
        sm: 'none',
        DEFAULT: 'none',
        md: 'none',
        lg: 'none',
        xl: 'none',
        '2xl': 'none',
        inner: 'none',
      },
    },
  },
  plugins: [],
};
