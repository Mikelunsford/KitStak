// ChannelsListPage. Co-Pack Pillar 3 library surface. Workstream C of the
// 2026-06-17 UI scan adds the server list toolbar (search on name, sortable
// headers, kind + active facets, keyset pager) behind feature.list_toolbar. The
// flag-off path is the original client-state view, extracted verbatim into
// ChannelsListLegacy; the flag-on path is ChannelsListToolbar. Both keep the
// inline create form and the per-row active toggle. The parent renders one or
// the other.
//
// Earlier migration note (F-Wave10-UI-KIT-01): PageHeader + DataTable +
// StatusBadge + Pagination replaced the hand-rolled header, table, and raw
// active pill. Sales channels are a flat library (no state machine), so create
// stays an inline form and the per-row active toggle stays a per-row component.
// The copack.channel.write gate is preserved. Channel kind is categorical,
// rendered as plain text (not a badge).

import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { ListToolbar } from '@/components/ui/ListToolbar';
import { SavedViewsBar } from '@/components/ui/SavedViewsBar';
import { Select } from '@/components/ui/Select';
import { TextInput } from '@/components/ui/TextInput';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { CursorPager } from '@/components/ui/CursorPager';
import { StatusBadge } from '@/components/ui/StatusBadge';
import {
  useSalesChannelsList,
  useCreateSalesChannel,
  useUpdateSalesChannel,
} from '@/lib/hooks/useCoPack';
import { useOrgFlags } from '@/lib/hooks/useOrgFlags';
import { useServerList } from '@/lib/hooks/useServerList';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import { listSalesChannelsPage } from '@/lib/services/copackService';
import { salesChannelsKeys } from '@/lib/queryKeys/copack';
import { FEATURE_FLAGS } from '@/lib/constants';
import type { SalesChannel, SalesChannelKind } from '@/lib/types/copack';

const PAGE_SIZE = 50;

// Channels are manual only until a real connector exists. The create picker
// offers Manual alone; the server enforces the same rule (copack-api rejects a
// non-manual kind with VALIDATION_ERROR). Legacy rows created before this rule
// may still carry shopify / amazon / other, so the display-label map keeps
// those names for read-back even though they are no longer selectable.
const CHANNEL_KINDS: ReadonlyArray<{ value: SalesChannelKind; label: string }> = [
  { value: 'manual', label: 'Manual' },
];

// Existing kinds an operator may still want to filter for, including legacy
// rows. The create picker is manual-only; the filter facet is broader so old
// shopify / amazon / other rows stay reachable.
const CHANNEL_KIND_FILTERS: ReadonlyArray<SalesChannelKind> = [
  'manual',
  'shopify',
  'amazon',
  'other',
];

const CHANNEL_KIND_LABELS: Record<string, string> = {
  manual: 'Manual',
  shopify: 'Shopify',
  amazon: 'Amazon',
  other: 'Other',
};

function channelKindLabel(kind: string): string {
  return CHANNEL_KIND_LABELS[kind] ?? kind;
}

// Base columns shared by both variants. The toolbar variant adds a sortKey on
// the Name header (an entry in the edge SORT_COLS allowlist); the legacy variant
// ignores the sort props it is not passed. The actions column is appended per
// variant because it depends on the runtime write capability.
const BASE_COLUMNS: ReadonlyArray<DataColumn<SalesChannel>> = [
  { key: 'name', header: 'Name', sortKey: 'name', cellClassName: 'text-ink', render: (c) => c.name },
  {
    key: 'kind',
    header: 'Kind',
    cellClassName: 'text-ink-dim text-xs',
    render: (c) => channelKindLabel(c.kind),
  },
  {
    key: 'active',
    header: 'Active',
    render: (c) => <StatusBadge status={c.is_active ? 'active' : 'inactive'} />,
  },
];

function withActionsColumn(
  base: ReadonlyArray<DataColumn<SalesChannel>>,
  canWrite: boolean,
): ReadonlyArray<DataColumn<SalesChannel>> {
  if (!canWrite) return base;
  return [
    ...base,
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (c: SalesChannel) => <ChannelRowActions channel={c} />,
    },
  ];
}

export function ChannelsListPage() {
  const flags = useOrgFlags();
  return flags.data[FEATURE_FLAGS.UI_LIST_TOOLBAR] ? (
    <ChannelsListToolbar />
  ) : (
    <ChannelsListLegacy />
  );
}

function ChannelCreateForm() {
  const create = useCreateSalesChannel();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<SalesChannelKind>('manual');

  function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate(
      { name: name.trim(), kind },
      {
        onSuccess: () => {
          setName('');
          setKind('manual');
        },
      },
    );
  }

  return (
    <form onSubmit={onCreate} className="flex flex-col gap-3 border border-line p-4">
      <h2 className="font-display tracking-wider text-ink">ADD SALES CHANNEL</h2>
      <div className="flex gap-3 flex-wrap items-end">
        <TextInput
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <label className="flex flex-col gap-2">
          <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">Kind</span>
          <Select value={kind} onChange={(e) => setKind(e.target.value as SalesChannelKind)}>
            {CHANNEL_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </Select>
        </label>
        <Button type="submit" disabled={!name.trim() || create.isPending}>
          {create.isPending ? 'Adding.' : 'Add channel'}
        </Button>
      </div>
      {create.error ? (
        <p className="text-accent font-sans text-sm">
          {create.error instanceof Error ? create.error.message : 'Create failed.'}
        </p>
      ) : null}
    </form>
  );
}

function ChannelsListToolbar() {
  const caps = useVioCapabilities();
  const canWrite = caps.can('copack.channel.write');
  const server = useServerList<SalesChannel>({
    enabled: true,
    queryKeyBase: salesChannelsKeys.all,
    fetchPage: listSalesChannelsPage,
    defaultSort: { by: 'created_at', dir: 'desc' },
    facets: [
      { key: 'kind', label: 'Kind', format: channelKindLabel },
      { key: 'is_active', label: 'Active' },
    ],
  });

  const columns = withActionsColumn(BASE_COLUMNS, canWrite);

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6 px-8 py-12">
      <PageHeader title="Sales channels" />
      <p className="font-sans text-ink-dim text-sm max-w-2xl">
        Sales channels define where your orders come from. Channels are manual for
        now. Automated connectors such as Shopify and Amazon are not available yet.
        Mark a channel inactive to hide it from new order forms without deleting its
        history.
      </p>

      <ListToolbar
        searchValue={server.searchInput}
        onSearchChange={server.setSearchInput}
        searchPlaceholder="Search name"
        chips={server.chips.map((chip) =>
          chip.key === 'is_active' && server.facetValues.is_active
            ? {
                ...chip,
                label: `Active: ${server.facetValues.is_active === 'true' ? 'Active' : 'Inactive'}`,
              }
            : chip,
        )}
        onClearAll={server.clearAll}
      >
        <label className="flex items-center gap-2">
          <span className="font-sans text-xs uppercase tracking-wide text-ink-dim">Kind</span>
          <Select
            value={server.facetValues.kind ?? ''}
            onChange={(e) => server.setFacet('kind', e.target.value)}
            aria-label="Filter by kind"
          >
            <option value="">All kinds</option>
            {CHANNEL_KIND_FILTERS.map((k) => (
              <option key={k} value={k}>
                {channelKindLabel(k)}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex items-center gap-2">
          <span className="font-sans text-xs uppercase tracking-wide text-ink-dim">Active</span>
          <Select
            value={server.facetValues.is_active ?? ''}
            onChange={(e) => server.setFacet('is_active', e.target.value)}
            aria-label="Filter by active state"
          >
            <option value="">All</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </Select>
        </label>
      </ListToolbar>

      <SavedViewsBar
        entityType="sales_channel"
        currentConfig={server.viewConfig}
        onApply={server.applyView}
      />

      {server.isError ? (
        <p className="text-accent font-sans text-sm">Failed to load channels.</p>
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={server.rows}
            getRowKey={(c) => c.id}
            loading={server.isLoading}
            empty="No sales channels match these filters."
            sortBy={server.sortBy}
            sortDir={server.sortDir}
            onSort={server.onSort}
          />
          <CursorPager
            canPrev={server.canPrev}
            canNext={server.canNext}
            onPrev={server.onPrev}
            onNext={server.onNext}
            label={`${server.rows.length} shown`}
          />
        </>
      )}

      {canWrite ? <ChannelCreateForm /> : null}
    </section>
  );
}

function ChannelsListLegacy() {
  const channels = useSalesChannelsList();
  const create = useCreateSalesChannel();
  const caps = useVioCapabilities();

  const [name, setName] = useState('');
  const [kind, setKind] = useState<SalesChannelKind>('manual');
  const [page, setPage] = useState(0);

  const canWrite = caps.can('copack.channel.write');

  function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!canWrite || !name.trim()) return;
    create.mutate(
      { name: name.trim(), kind },
      {
        onSuccess: () => {
          setName('');
          setKind('manual');
        },
      },
    );
  }

  const columns: ReadonlyArray<DataColumn<SalesChannel>> = [
    { key: 'name', header: 'Name', cellClassName: 'text-ink', render: (c) => c.name },
    {
      key: 'kind',
      header: 'Kind',
      cellClassName: 'text-ink-dim text-xs',
      render: (c) => channelKindLabel(c.kind),
    },
    {
      key: 'active',
      header: 'Active',
      render: (c) => (
        <StatusBadge status={c.is_active ? 'active' : 'inactive'} />
      ),
    },
    ...(canWrite
      ? ([
          {
            key: 'actions',
            header: '',
            align: 'right',
            render: (c: SalesChannel) => <ChannelRowActions channel={c} />,
          },
        ] as DataColumn<SalesChannel>[])
      : []),
  ];

  const rows = channels.data ?? [];
  const totalCount = rows.length;
  const { sliceStart, sliceEnd } = paginate(totalCount, PAGE_SIZE, page);
  const pageRows = rows.slice(sliceStart, sliceEnd);

  const meta =
    !channels.isLoading && !channels.error
      ? `${totalCount} ${totalCount === 1 ? 'channel' : 'channels'}`
      : undefined;

  return (
    <section className="mx-auto flex max-w-4xl flex-col gap-6 px-8 py-12">
      <PageHeader
        title="Sales channels"
        meta={meta}
      />
      <p className="font-sans text-ink-dim text-sm max-w-2xl">
        Sales channels define where your orders come from. Channels are manual
        for now. Automated connectors such as Shopify and Amazon are not
        available yet. Mark a channel inactive to hide it from new order forms
        without deleting its history.
      </p>

      {channels.error ? (
        <p className="text-accent font-sans text-sm">
          {channels.error instanceof Error
            ? channels.error.message
            : 'Failed to load channels.'}
        </p>
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={pageRows}
            getRowKey={(c) => c.id}
            loading={channels.isLoading}
            empty="No sales channels yet."
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

      {canWrite ? (
        <form
          onSubmit={onCreate}
          className="flex flex-col gap-3 border border-line p-4"
        >
          <h2 className="font-display tracking-wider text-ink">
            ADD SALES CHANNEL
          </h2>
          <div className="flex gap-3 flex-wrap items-end">
            <TextInput
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <label className="flex flex-col gap-2">
              <span className="font-sans text-sm text-ink-dim tracking-wide uppercase">
                Kind
              </span>
              <Select
                value={kind}
                onChange={(e) => setKind(e.target.value as SalesChannelKind)}
              >
                {CHANNEL_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </Select>
            </label>
            <Button type="submit" disabled={!name.trim() || create.isPending}>
              {create.isPending ? 'Adding.' : 'Add channel'}
            </Button>
          </div>
          {create.error ? (
            <p className="text-accent font-sans text-sm">
              {create.error instanceof Error
                ? create.error.message
                : 'Create failed.'}
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}

function ChannelRowActions({ channel }: { channel: SalesChannel }) {
  const update = useUpdateSalesChannel(channel.id);

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        variant="ghost"
        onClick={() => update.mutate({ is_active: !channel.is_active })}
        disabled={update.isPending}
      >
        {channel.is_active ? 'Deactivate' : 'Activate'}
      </Button>
      {update.error ? (
        <span className="text-accent text-xs">
          {update.error instanceof Error
            ? update.error.message
            : 'Update failed.'}
        </span>
      ) : null}
    </span>
  );
}
