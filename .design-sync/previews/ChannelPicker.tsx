import { ChannelPicker } from 'kitstak-ui';

export function Closed() {
  return (
    <ChannelPicker
      value=""
      onChange={() => {}}
      label="Channel"
      placeholder="No channel"
    />
  );
}
