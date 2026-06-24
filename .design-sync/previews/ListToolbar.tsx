import { ListToolbar, Select } from 'kitstak-ui';

const noop = () => {};

export function WithFacets() {
  return (
    <ListToolbar
      searchValue="Acme"
      onSearchChange={noop}
      searchPlaceholder="Search invoices"
    >
      <Select aria-label="Status" defaultValue="all">
        <option value="all">All statuses</option>
        <option value="paid">Paid</option>
        <option value="overdue">Overdue</option>
        <option value="draft">Draft</option>
      </Select>
      <Select aria-label="Customer" defaultValue="all">
        <option value="all">All customers</option>
        <option value="acme">Acme Logistics</option>
        <option value="northwind">Northwind Freight</option>
      </Select>
    </ListToolbar>
  );
}

export function WithActiveChips() {
  return (
    <ListToolbar
      searchValue="Northwind"
      onSearchChange={noop}
      searchPlaceholder="Search purchase orders"
      chips={[
        { key: 'q', label: 'Search: Northwind', onClear: noop },
        { key: 'status', label: 'Status: Overdue', onClear: noop },
      ]}
      onClearAll={noop}
    >
      <Select aria-label="Warehouse" defaultValue="all">
        <option value="all">All warehouses</option>
        <option value="tacoma">Tacoma DC</option>
        <option value="reno">Reno DC</option>
      </Select>
    </ListToolbar>
  );
}
