import { CursorPager } from 'kitstak-ui';

const noop = () => {};

export function FirstPage() {
  return <CursorPager canPrev={false} canNext onPrev={noop} onNext={noop} label="Showing 50 stock movements" />;
}

export function MiddlePage() {
  return <CursorPager canPrev canNext onPrev={noop} onNext={noop} label="Showing 50" />;
}

export function LastPage() {
  return <CursorPager canPrev canNext={false} onPrev={noop} onNext={noop} label="Showing 18" />;
}

export function NoLabel() {
  return <CursorPager canPrev canNext onPrev={noop} onNext={noop} />;
}
