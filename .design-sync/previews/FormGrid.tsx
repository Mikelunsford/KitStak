import { FormGrid, TextInput } from 'kitstak-ui';

export function TwoColumn() {
  return (
    <FormGrid>
      <TextInput label="Invoice number" defaultValue="INV-3092" />
      <TextInput label="Customer" defaultValue="Acme Logistics" />
      <TextInput label="Issue date" defaultValue="2025-06-01" />
      <TextInput label="Due date" defaultValue="2025-06-12" />
      <FormGrid.Full>
        <TextInput label="Notes" placeholder="Net 11 terms, pallet storage for Tacoma DC" />
      </FormGrid.Full>
    </FormGrid>
  );
}

export function ThreeColumn() {
  return (
    <FormGrid columns={3}>
      <TextInput label="SKU" defaultValue="SKU-4410" />
      <TextInput label="Quantity" defaultValue="240" />
      <TextInput label="Unit cost" defaultValue="$3.75" />
    </FormGrid>
  );
}
