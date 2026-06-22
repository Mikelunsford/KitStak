// BomsListPage. Migration to the shared UI kit (F-Wave10-UI-KIT-01, 3PL CRUD
// tail): PageHeader + DataTable + Pagination replace the hand-rolled header and
// table. BOMs have no status or money columns, so this is a plain reference
// list. The client-side group-and-count derivation (a "BOM" is the set of
// bom_items sharing a parent_item_id) and the create gate are preserved.

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { LINK_CLASS } from '@/components/data/entityLabelStyles';
import { ListEmptyState } from '@/components/shell/ListEmptyState';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { useBomItemsList } from '@/lib/hooks/useInventory';
import { useItemsList } from '@/lib/hooks/useItems';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';

const PAGE_SIZE = 50;

interface BomRow {
  parentItemId: string;
  label: string;
  componentCount: number;
}

const COLUMNS: ReadonlyArray<DataColumn<BomRow>> = [
  {
    key: 'item',
    header: 'Finished item',
    render: (row) => (
      <Link to={`/catalog/boms/${row.parentItemId}`} className={LINK_CLASS}>
        {row.label}
      </Link>
    ),
  },
  {
    key: 'components',
    header: 'Components',
    align: 'right',
    cellClassName: 'tabular-nums text-ink-dim',
    render: (row) => row.componentCount,
  },
];

export function BomsListPage() {
  const { data: lines, isLoading } = useBomItemsList();
  const { data: items } = useItemsList();
  const caps = useVioCapabilities();
  const [page, setPage] = useState(0);

  const itemLabel = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items ?? []) {
      map.set(item.id, `${item.sku} · ${item.name}`);
    }
    return map;
  }, [items]);

  const rows = useMemo<BomRow[]>(() => {
    const counts = new Map<string, number>();
    for (const line of lines ?? []) {
      counts.set(line.parent_item_id, (counts.get(line.parent_item_id) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([parentItemId, componentCount]) => ({
        parentItemId,
        label: itemLabel.get(parentItemId) ?? parentItemId,
        componentCount,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [lines, itemLabel]);

  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  const meta = !isLoading
    ? `${totalCount} ${totalCount === 1 ? 'BOM' : 'BOMs'}`
    : undefined;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-6 px-8 py-12">
      <PageHeader
        title="Bills of materials"
        meta={meta}
        actions={
          caps.can('stock.bom.write') ? (
            <Link to="/catalog/boms/new">
              <Button variant="primary">New BOM</Button>
            </Link>
          ) : undefined
        }
      />

      {!isLoading && rows.length === 0 ? (
        <ListEmptyState
          entity="bill of materials"
          explainer="A bill of materials lists the component items and quantities that go into building a finished product."
          addLabel="Add BOM"
          addTo="/catalog/boms/new"
          canAdd={caps.can('stock.bom.write')}
        />
      ) : (
        <>
          <DataTable
            columns={COLUMNS}
            rows={pageRows}
            getRowKey={(row) => row.parentItemId}
            loading={isLoading}
            empty="No bills of materials yet."
          />
          {totalCount > PAGE_SIZE ? (
            <Pagination
              page={page}
              totalCount={totalCount}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
            />
          ) : null}
        </>
      )}
    </section>
  );
}
