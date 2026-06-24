import { DataTable, StatusBadge } from 'kitstak-ui';

interface InvoiceRow {
  id: string;
  number: string;
  customer: string;
  status: string;
  due: string;
  total: string;
}

const invoices: InvoiceRow[] = [
  { id: '1', number: 'INV-3092', customer: 'Acme Logistics', status: 'paid', due: 'Jun 12, 2025', total: '$18,450.00' },
  { id: '2', number: 'INV-3093', customer: 'Northwind Freight', status: 'overdue', due: 'May 30, 2025', total: '$7,210.00' },
  { id: '3', number: 'INV-3094', customer: 'Cascade Cold Storage', status: 'partially_paid', due: 'Jun 28, 2025', total: '$32,900.00' },
  { id: '4', number: 'INV-3095', customer: 'Harbor Point Distribution', status: 'draft', due: 'Jul 05, 2025', total: '$4,120.00' },
];

const columns = [
  { key: 'number', header: 'Invoice', render: (r: InvoiceRow) => <span className="font-mono">{r.number}</span> },
  { key: 'customer', header: 'Customer', render: (r: InvoiceRow) => r.customer },
  { key: 'status', header: 'Status', render: (r: InvoiceRow) => <StatusBadge status={r.status} /> },
  { key: 'due', header: 'Due', render: (r: InvoiceRow) => r.due },
  { key: 'total', header: 'Total', align: 'right' as const, render: (r: InvoiceRow) => <span className="tabular-nums">{r.total}</span> },
];

export function Invoices() {
  return <DataTable columns={columns} rows={invoices} getRowKey={(r) => r.id} />;
}

export function Empty() {
  return (
    <DataTable
      columns={columns}
      rows={[]}
      getRowKey={(r) => r.id}
      empty="No invoices match these filters."
    />
  );
}
