/**
 * EntityLabel. Resolves a foreign-key UUID to a human-readable label
 * (`{code ?? short_label} · {display_name}`) using the matching list hook
 * for the given kind. Falls back to the raw id when the row cannot be
 * resolved (fetch in flight, deleted parent, cross-tenant filter, etc.).
 *
 * Mirrors the shape originally introduced by PR #31 for the warehouse
 * column on ReceivingOrderDetailPage (F-Wave6-WAREHOUSE-NAME-01).
 *
 * Display-only. Does not gate, mutate, or trigger network calls beyond
 * the list query the matching hook already manages.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { useChartOfAccounts } from '@/lib/hooks/useChartOfAccounts';
import { useCustomers } from '@/lib/hooks/useCustomers';
import { useItemsList } from '@/lib/hooks/useItems';
import { useWarehousesList } from '@/lib/hooks/useInventory';
import { useProjectsList } from '@/lib/hooks/useProjects';
import { useVendorsList } from '@/lib/hooks/useVendors';
import { contactsKeys } from '@/lib/queryKeys/contacts';
import { opportunitiesKeys } from '@/lib/queryKeys/opportunities';
import { listContacts } from '@/lib/services/contactsService';
import { listOpportunities } from '@/lib/services/opportunitiesService';

export type EntityKind =
  | 'warehouse'
  | 'item'
  | 'customer'
  | 'vendor'
  | 'project'
  | 'contact'
  | 'account'
  | 'opportunity';

interface EntityLabelProps {
  kind: EntityKind;
  id: string | null | undefined;
}

const C = { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 as const };

function format(code: string | null | undefined, displayName: string): string {
  return code ? `${code} · ${displayName}` : displayName;
}

function WarehouseLabel({ id }: { id: string }) {
  const q = useWarehousesList();
  const row = q.data?.find((w) => w.id === id);
  if (!row) return <span className="text-ink">{id}</span>;
  return (
    <Link to={`/3pl-operations/warehouses/${id}`} className="text-ink underline">
      {format(row.code, row.display_name)}
    </Link>
  );
}

function ItemLabel({ id }: { id: string }) {
  const q = useItemsList();
  const row = q.data?.find((it) => it.id === id);
  if (!row) return <span className="text-ink">{id}</span>;
  return (
    <Link to={`/3pl-operations/items/${id}`} className="text-ink underline">
      {format(row.sku, row.name)}
    </Link>
  );
}

function CustomerLabel({ id }: { id: string }) {
  const q = useCustomers();
  const row = q.data?.find((c) => c.id === id);
  if (!row) return <span className="text-ink">{id}</span>;
  return (
    <Link to={`/crm/customers/${id}`} className="text-ink underline">
      {format(null, row.display_name)}
    </Link>
  );
}

function VendorLabel({ id }: { id: string }) {
  const q = useVendorsList();
  const row = q.data?.items.find((v) => v.id === id);
  if (!row) return <span className="text-ink">{id}</span>;
  return (
    <Link to={`/3pl-operations/vendors/${id}`} className="text-ink underline">
      {format(row.vendor_number, row.display_name)}
    </Link>
  );
}

function ProjectLabel({ id }: { id: string }) {
  const q = useProjectsList();
  const row = q.data?.find((p) => p.id === id);
  if (!row) return <span className="text-ink">{id}</span>;
  return (
    <Link to={`/3pl-operations/projects/${id}`} className="text-ink underline">
      {format(row.number, row.name)}
    </Link>
  );
}

function ContactLabel({ id }: { id: string }) {
  const q = useQuery({
    queryKey: contactsKeys.list({}),
    queryFn: () => listContacts({}),
    ...C,
  });
  const row = q.data?.find((c) => c.id === id);
  if (!row) return <span className="text-ink">{id}</span>;
  const displayName = [row.first_name, row.last_name].filter(Boolean).join(' ');
  return (
    <Link to={`/crm/contacts/${id}`} className="text-ink underline">
      {format(null, displayName)}
    </Link>
  );
}

function AccountLabel({ id }: { id: string }) {
  const q = useChartOfAccounts();
  const row = q.data?.find((a) => a.id === id);
  if (!row) return <span className="text-ink">{id}</span>;
  return <span className="text-ink">{format(row.code, row.name)}</span>;
}

function OpportunityLabel({ id }: { id: string }) {
  const q = useQuery({
    queryKey: opportunitiesKeys.list({}),
    queryFn: () => listOpportunities({}),
    ...C,
  });
  const row = q.data?.find((o) => o.id === id);
  if (!row) return <span className="text-ink">{id}</span>;
  return (
    <Link to={`/crm/opportunities/${id}`} className="text-ink underline">
      {format(null, row.display_name)}
    </Link>
  );
}

export function EntityLabel({ kind, id }: EntityLabelProps) {
  if (!id) return <span className="text-ink">{''}</span>;
  switch (kind) {
    case 'warehouse':
      return <WarehouseLabel id={id} />;
    case 'item':
      return <ItemLabel id={id} />;
    case 'customer':
      return <CustomerLabel id={id} />;
    case 'vendor':
      return <VendorLabel id={id} />;
    case 'project':
      return <ProjectLabel id={id} />;
    case 'contact':
      return <ContactLabel id={id} />;
    case 'account':
      return <AccountLabel id={id} />;
    case 'opportunity':
      return <OpportunityLabel id={id} />;
  }
}
