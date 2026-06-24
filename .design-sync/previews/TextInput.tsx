import { TextInput } from 'kitstak-ui';

export function Default() {
  return <TextInput label="Company name" defaultValue="Acme Logistics" />;
}

export function WithPlaceholder() {
  return <TextInput label="Email" placeholder="ops@acme.com" />;
}

export function WithError() {
  return <TextInput label="PO number" defaultValue="PO-99" error="That purchase order already exists" />;
}

export function Disabled() {
  return <TextInput label="Account ID" defaultValue="ACC-1042" disabled />;
}
