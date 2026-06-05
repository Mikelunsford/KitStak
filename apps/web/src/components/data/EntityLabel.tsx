/**
 * EntityLabel. Resolves a foreign-key UUID to a human-readable label
 * (`{code ?? short_label} · {display_name}`) using the matching list hook
 * for the given kind. While the list query is in flight we render a
 * short-prefix placeholder so the operator never sees a raw UUID flash
 * on first paint (BNEW-8 from the 2026-05-22 v2 smoke walk). When the
 * fetch settles and the row is genuinely missing (deleted parent,
 * cross-tenant filter), we still fall back to the raw id so the field
 * stays diagnosable.
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
import { useSalesOrdersList, useCoPackWarehousesList } from '@/lib/hooks/useCoPack';
import { useVendorsList } from '@/lib/hooks/useVendors';
import { contactsKeys } from '@/lib/queryKeys/contacts';
import { opportunitiesKeys } from '@/lib/queryKeys/opportunities';
import { listContacts } from '@/lib/services/contactsService';
import { listOpportunities } from '@/lib/services/opportunitiesService';

import { classifyEntityLabel } from './entityLabelState';

export type EntityKind =
  | 'warehouse'
  | 'item'
  | 'customer'
  | 'vendor'
  | 'project'
  | 'contact'
  | 'account'
  | 'opportunity'
  | 'sales_order'
  | 'copack_warehouse';

interface EntityLabelProps {
  kind: EntityKind;
  id: string | null | undefined;
}

const C = { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 as const };

function format(code: string | null | undefined, displayName: string): string {
  return code ? `${code} · ${displayName}` : displayName;
}

/**
 * In-flight placeholder. Shown while the matching list query has not
 * settled yet. Renders the short id prefix (first 8 chars) so the UI
 * keeps a stable width without leaking the full UUID to the operator.
 * BNEW-8.
 */
function PendingLabel({ id }: { id: string }) {
  return (
    <span
      className="text-ink-dim"
      data-testid="entity-label-pending"
      aria-busy="true"
    >
      {id.slice(0, 8)}…
    </span>
  );
}

function WarehouseLabel({ id }: { id: string }) {
  const q = useWarehousesList();
  const state = classifyEntityLabel(q.data, id);
  if (state === 'pending') return <PendingLabel id={id} />;
  const row = q.data?.find((w) => w.id === id);
  if (!row) return <span className="text-ink">{id}</span>;
  return (
    <Link to={`/inventory/warehouses/${id}`} className="text-ink underline">
      {format(row.code, row.display_name)}
    </Link>
  );
}

function ItemLabel({ id }: { id: string }) {
  const q = useItemsList();
  const state = classifyEntityLabel(q.data, id);
  if (state === 'pending') return <PendingLabel id={id} />;
  const row = q.data?.find((it) => it.id === id);
  if (!row) return <span className="text-ink">{id}</span>;
  return (
    <Link to={`/catalog/items/${id}`} className="text-ink underline">
      {format(row.sku, row.name)}
    </Link>
  );
}

function CustomerLabel({ id }: { id: string }) {
  const q = useCustomers();
  const state = classifyEntityLabel(q.data, id);
  if (state === 'pending') return <PendingLabel id={id} />;
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
  // useVendorsList wraps rows in { items: [...] } — adapt before classifying.
  const items = q.data?.items;
  const state = classifyEntityLabel(items, id);
  if (state === 'pending') return <PendingLabel id={id} />;
  const row = items?.find((v) => v.id === id);
  if (!row) return <span className="text-ink">{id}</span>;
  return (
    <Link to={`/purchasing/vendors/${id}`} className="text-ink underline">
      {format(row.vendor_number, row.display_name)}
    </Link>
  );
}

function ProjectLabel({ id }: { id: string }) {
  const q = useProjectsList();
  const state = classifyEntityLabel(q.data, id);
  if (state === 'pending') return <PendingLabel id={id} />;
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
  const state = classifyEntityLabel(q.data, id);
  if (state === 'pending') return <PendingLabel id={id} />;
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
  const state = classifyEntityLabel(q.data, id);
  if (state === 'pending') return <PendingLabel id={id} />;
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
  const state = classifyEntityLabel(q.data, id);
  if (state === 'pending') return <PendingLabel id={id} />;
  const row = q.data?.find((o) => o.id === id);
  if (!row) return <span className="text-ink">{id}</span>;
  return (
    <Link to={`/crm/opportunities/${id}`} className="text-ink underline">
      {format(null, row.display_name)}
    </Link>
  );
}

function SalesOrderLabel({ id }: { id: string }) {
  const q = useSalesOrdersList();
  const state = classifyEntityLabel(q.data, id);
  if (state === 'pending') return <PendingLabel id={id} />;
  const row = q.data?.find((o) => o.id === id);
  if (!row) return <span className="text-ink">{id}</span>;
  return (
    <Link to={`/copack/orders/${id}`} className="text-ink underline">
      {row.order_number ?? id.slice(0, 8)}
    </Link>
  );
}

// Co-Pack-scoped warehouse label. Resolves through the copack_ecom bundle
// (useCoPackWarehousesList) instead of the 3PL-gated inventory-api, so a
// Co-Pack-only org sees the warehouse name, not a raw UUID. Rendered as plain
// text (no link) because the warehouse detail route reads through the
// 3PL-gated inventory-api, which a Co-Pack-only org cannot call.
function CoPackWarehouseLabel({ id }: { id: string }) {
  const q = useCoPackWarehousesList();
  const state = classifyEntityLabel(q.data, id);
  if (state === 'pending') return <PendingLabel id={id} />;
  const row = q.data?.find((w) => w.id === id);
  if (!row) return <span className="text-ink">{id}</span>;
  return <span className="text-ink">{format(row.code, row.display_name)}</span>;
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
    case 'sales_order':
      return <SalesOrderLabel id={id} />;
    case 'copack_warehouse':
      return <CoPackWarehouseLabel id={id} />;
  }
}
