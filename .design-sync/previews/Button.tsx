import { Button } from 'kitstak-ui';

export function Primary() {
  return <Button>Save changes</Button>;
}

export function Secondary() {
  return <Button variant="secondary">Cancel</Button>;
}

export function Ghost() {
  return <Button variant="ghost">Dismiss</Button>;
}

export function Disabled() {
  return <Button disabled>Saving</Button>;
}
