// ChannelsListPage. Co-Pack Pillar 3 library surface. Migration to the shared
// UI kit (F-Wave10-UI-KIT-01): PageHeader + DataTable + StatusBadge +
// Pagination replace the hand-rolled header, table, and raw active pill. Sales
// channels are a flat library (no state machine), so create stays an inline
// form (with its kit-Select kind picker) and the per-row active toggle stays a
// per-row component. The copack.channel.write gate is preserved. Channel kind
// is categorical, rendered as plain text (not a badge).

import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { TextInput } from '@/components/ui/TextInput';
import { DataTable, type DataColumn } from '@/components/ui/DataTable';
import { Pagination, paginate } from '@/components/ui/Pagination';
import { StatusBadge } from '@/components/ui/StatusBadge';
import {
  useSalesChannelsList,
  useCreateSalesChannel,
  useUpdateSalesChannel,
} from '@/lib/hooks/useCoPack';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import type { SalesChannel, SalesChannelKind } from '@/lib/types/copack';

const PAGE_SIZE = 50;

const CHANNEL_KINDS: ReadonlyArray<{ value: SalesChannelKind; label: string }> = [
  { value: 'manual', label: 'Manual' },
  { value: 'shopify', label: 'Shopify' },
  { value: 'amazon', label: 'Amazon' },
  { value: 'other', label: 'Other' },
];

const CHANNEL_KIND_LABELS: Record<string, string> = Object.fromEntries(
  CHANNEL_KINDS.map((k) => [k.value, k.label]),
);

function channelKindLabel(kind: string): string {
  return CHANNEL_KIND_LABELS[kind] ?? kind;
}

export function ChannelsListPage() {
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
        eyebrow="Co-Pack and Ecom / Sales channels"
        title="Sales channels"
        meta={meta}
      />
      <p className="font-sans text-ink-dim text-sm max-w-2xl">
        Sales channels define where your orders come from. Mark a channel
        inactive to hide it from new order forms without deleting its history.
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
