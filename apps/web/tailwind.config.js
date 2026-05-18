/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // The three customer-overridable surfaces resolve through CSS
        // variables so BrandingProvider's runtime injection can repaint
        // the theme without a rebuild. Defaults live in styles.css :root.
        bg: {
          DEFAULT: 'rgb(var(--bg) / <alpha-value>)',
          2: '#0f1d33',
          3: '#152540',
        },
        ink: {
          DEFAULT: 'rgb(var(--ink) / <alpha-value>)',
          dim: '#8a9bb0',
          faint: '#2d3f55',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          bright: '#e62e4d',
          soft: 'rgba(200, 16, 46, 0.1)',
        },
        line: {
          DEFAULT: '#1a2c47',
          strong: '#2d3f55',
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
      borderRadius: {
        DEFAULT: '0',
        pill: '9999px',
      },
    },
  },
  plugins: [],
};
