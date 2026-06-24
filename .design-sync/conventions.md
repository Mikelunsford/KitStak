# Kitstak UI conventions

Kitstak is the operating system for 3PL, manufacturing, co-pack, and ecommerce
fulfillment operators. This is its component library. Build with these real
components; do not reinvent primitives.

## Surface and setup (read first)

Kitstak is a **navy-first dark theme**. The design tokens are CSS variables on
`:root` and are applied to the page by the app's `<body>`: `--bg` is navy and
`--ink` is cream. **Always render screens on the brand surface** by putting the
content in a `bg-bg text-ink` container (or styling `<body>` that way).
Cream-on-white is invisible, so a component dropped on a default white page will
look broken. A light theme exists (`:root[data-theme='light']`) but navy is the
default and the brand.

Two components reach React context:
- Components with links or tabs (`Tabs`, `StatCard`, `ActionTile`, `DetailHeader`)
  render react-router `Link`/`useSearchParams`, so the app must be inside a
  react-router Router.
- The `pickers/*` family, `CurrencyField`, `SavedViewsBar`, and
  `BillableLineItemsEditor` fetch live data (TanStack Query); they show a
  closed/empty state until wired to the backend.

## Styling idiom: Tailwind utilities backed by brand tokens

Style with Tailwind utility classes. The palette comes from the tokens below
(never hardcode hex). Real, available class families:

| Purpose | Classes |
|---|---|
| Surfaces (raise by tier) | `bg-bg`, `bg-bg-2`, `bg-bg-3` |
| Text | `text-ink` (primary), `text-ink-dim` (secondary), `text-ink-faint` |
| Accent / CTA (Kitstak red) | `bg-accent`, `bg-accent-bright`, `text-accent`, `text-on-primary` |
| Borders | `border-line`, `border-line-strong` |
| Status | `text-success`/`bg-success`, `warning`, `danger`, `info` |
| Type | `font-display` (Bebas Neue, headings/eyebrows), `font-sans` (Inter Tight, body), `font-mono` (JetBrains Mono, codes and numerals) |

Headings (`h1`-`h6`) automatically use Bebas Neue. Tabular numerals and
reference codes use `font-mono`. Buttons use `Button` with `variant="primary"`
(red), `"secondary"` (bordered navy), or `"ghost"`.

## Where the truth lives

- Tokens and base styles: `styles.css` (and its `@import` of `_ds_bundle.css`).
- Per component: `<Name>.d.ts` (props) and `<Name>.prompt.md` (usage examples).
  Read those before composing a component.

## Idiomatic example

```tsx
import { Button, StatusBadge, PageHeader } from 'kitstak-ui';

function InvoicesScreen() {
  return (
    <div className="bg-bg text-ink min-h-screen p-8">
      <PageHeader title="Invoices" meta="128 invoices, $84,210 outstanding" />
      <div className="mt-6 flex items-center gap-3">
        <StatusBadge status="overdue" />
        <span className="font-mono text-ink-dim">INV-3092</span>
        <Button variant="primary">Record payment</Button>
      </div>
    </div>
  );
}
```
