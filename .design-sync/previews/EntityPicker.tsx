import { useState } from 'react';
import { EntityPicker } from 'kitstak-ui';

interface Customer {
  id: string;
  name: string;
}

const customers: Customer[] = [
  { id: 'cust-acme', name: 'Acme Logistics' },
  { id: 'cust-northwind', name: 'Northwind Freight' },
  { id: 'cust-cascade', name: 'Cascade Cold Storage' },
  { id: 'cust-harbor', name: 'Harbor Point Distribution' },
];

const getId = (c: Customer) => c.id;
const getLabel = (c: Customer) => c.name;

export function CustomerSelect() {
  const [value, setValue] = useState<string | null>('cust-acme');
  return (
    <EntityPicker
      label="Customer"
      value={value}
      onChange={setValue}
      options={customers}
      getOptionId={getId}
      getOptionLabel={getLabel}
      placeholder="Search customers."
    />
  );
}

export function Empty() {
  const [value, setValue] = useState<string | null>(null);
  return (
    <EntityPicker
      label="Bill to account"
      value={value}
      onChange={setValue}
      options={customers}
      getOptionId={getId}
      getOptionLabel={getLabel}
      placeholder="Search accounts."
      required
    />
  );
}

export function WithCreate() {
  const [value, setValue] = useState<string | null>(null);
  return (
    <EntityPicker
      label="Vendor"
      value={value}
      onChange={setValue}
      options={customers}
      getOptionId={getId}
      getOptionLabel={getLabel}
      placeholder="Search vendors."
      allowCreate
      createLabel="New vendor"
      onCreate={() => {}}
    />
  );
}

export function Loading() {
  return (
    <EntityPicker
      label="Warehouse"
      value={null}
      onChange={() => {}}
      options={[]}
      getOptionId={getId}
      getOptionLabel={getLabel}
      loading
    />
  );
}
