import { DetailHeader, Button } from 'kitstak-ui';

export function Invoice() {
  return (
    <DetailHeader
      title="Acme Logistics June Storage"
      number="INV-3092"
      status="partially_paid"
      customer={{ label: 'Acme Logistics', to: '/customers/acme-logistics' }}
      money={{ label: 'Balance', value: '$12,300.00' }}
      links={[
        { label: 'Project: Q2 Outbound', to: '/projects/q2-outbound' },
        { label: 'Source quote QTE-1180', to: '/quotes/qte-1180' },
      ]}
      actions={<Button>Record payment</Button>}
    />
  );
}

export function CustomerHub() {
  return (
    <DetailHeader
      title="Northwind Freight"
      status="active"
      money={{ label: 'Open balance', value: '$7,210.00' }}
      actions={<Button variant="secondary">New quote</Button>}
    />
  );
}

export function PurchaseOrder() {
  return (
    <DetailHeader
      title="Pallet wrap restock"
      number="PO-2025-118"
      customer={{ label: 'Cascade Cold Storage', to: '/vendors/cascade-cold-storage' }}
      money={{ label: 'Total', value: '$4,860.00' }}
    />
  );
}
