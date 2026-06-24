import { PageHeader, Button } from 'kitstak-ui';

export function Default() {
  return <PageHeader title="Quotes" />;
}

export function WithMeta() {
  return <PageHeader title="Purchase orders" meta="42 orders, 7 awaiting approval" />;
}

export function WithActions() {
  return (
    <PageHeader
      title="Invoices"
      meta="128 invoices, $84,210.50 outstanding"
      actions={<Button>New invoice</Button>}
    />
  );
}

export function WithMultipleActions() {
  return (
    <PageHeader
      title="Inventory"
      meta="3 warehouses, 1,204 SKUs tracked"
      actions={
        <>
          <Button variant="secondary">Export</Button>
          <Button>Adjust stock</Button>
        </>
      }
    />
  );
}
