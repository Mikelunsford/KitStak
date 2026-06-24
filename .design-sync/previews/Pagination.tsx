import { Pagination } from 'kitstak-ui';

const noop = () => {};

export function FirstPage() {
  return <Pagination page={0} totalCount={128} pageSize={25} onPageChange={noop} />;
}

export function MiddlePage() {
  return <Pagination page={2} totalCount={128} pageSize={25} onPageChange={noop} />;
}

export function LastPage() {
  return <Pagination page={5} totalCount={128} pageSize={25} onPageChange={noop} />;
}

export function SinglePage() {
  return <Pagination page={0} totalCount={12} pageSize={25} onPageChange={noop} />;
}

export function Empty() {
  return <Pagination page={0} totalCount={0} pageSize={25} onPageChange={noop} />;
}
