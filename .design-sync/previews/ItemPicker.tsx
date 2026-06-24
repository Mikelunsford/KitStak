import { ItemPicker } from 'kitstak-ui';

export function Closed() {
  return (
    <ItemPicker
      value=""
      onChange={() => {}}
      label="Item"
      placeholder="Search items"
    />
  );
}
