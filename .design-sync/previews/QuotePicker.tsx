import { QuotePicker } from 'kitstak-ui';

export function Closed() {
  return (
    <QuotePicker
      value=""
      onChange={() => {}}
      label="Source quote"
      placeholder="Select a quote"
    />
  );
}
