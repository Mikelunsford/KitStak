import { FilterBar, TextInput } from 'kitstak-ui';

const noop = () => {};

export function SearchOnly() {
  return (
    <FilterBar>
      <TextInput label="Search" placeholder="Search quotes by customer or number" />
    </FilterBar>
  );
}

export function WithControls() {
  return (
    <FilterBar>
      <TextInput label="Search" placeholder="SKU, PO number, customer" />
      <select className="bg-bg-2 border border-line text-ink px-4 py-3 font-sans">
        <option>All statuses</option>
        <option>Submitted</option>
        <option>Approved</option>
        <option>Shipped</option>
      </select>
    </FilterBar>
  );
}

export function WithActiveChips() {
  return (
    <FilterBar
      chips={[
        { key: 'status', label: 'Status: Submitted', onClear: noop },
        { key: 'warehouse', label: 'Warehouse: Dallas DC', onClear: noop },
      ]}
      onClearAll={noop}
    >
      <TextInput label="Search" placeholder="Search shipments" />
    </FilterBar>
  );
}

export function ManyChips() {
  return (
    <FilterBar
      chips={[
        { key: 'customer', label: 'Customer: Acme Logistics', onClear: noop },
        { key: 'status', label: 'Status: Overdue', onClear: noop },
        { key: 'range', label: 'Due: This month', onClear: noop },
      ]}
      onClearAll={noop}
    />
  );
}
