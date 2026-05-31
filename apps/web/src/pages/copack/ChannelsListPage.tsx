import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import {
  useSalesChannelsList,
  useCreateSalesChannel,
  useUpdateSalesChannel,
} from '@/lib/hooks/useCoPack';
import { useVioCapabilities } from '@/lib/hooks/useVioCapabilities';
import type { SalesChannel, SalesChannelKind } from '@/lib/types/copack';

/**
 * ChannelsListPage. Pillar 3 library surface. Sales channels are a flat
 * library table (no state machine), so this is a single list with an inline
 * create form and a per-row active toggle. Both writes gate on
 * copack.channel.write; the server stays the authority via RLS + requireCap.
 */
const CHANNEL_KINDS: ReadonlyArray<{ value: SalesChannelKind; label: string }> = [
  { value: 'manual', label: 'Manual' },
  { value: 'shopify', label: 'Shopify' },
  { value: 'amazon', label: 'Amazon' },
  { value: 'other', label: 'Other' },
];

export function ChannelsListPage() {
  const channels = useSalesChannelsList();
  const create = useCreateSalesChannel();
  const caps = useVioCapabilities();

  const [name, setName] = useState('');
  const [kind, setKind] = useState<SalesChannelKind>('manual');

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

  return (
    <section className="px-8 py-12 max-w-4xl mx-auto flex flex-col gap-6">
      <h1 className="text-4xl font-display tracking-wide text-ink">SALES CHANNELS</h1>
      <p className="font-sans text-ink-dim text-sm max-w-2xl">
        Sales channels define where your orders come from. Mark a channel inactive to
        hide it from new order forms without deleting its history.
      </p>

      {channels.isLoading ? <p className="text-ink-dim">Loading.</p> : null}
      {channels.error ? (
        <p className="text-accent font-sans text-sm">
          {channels.error instanceof Error ? channels.error.message : 'Failed to load channels.'}
        </p>
      ) : null}

      {!channels.isLoading && !channels.error ? (
        <table className="w-full border border-line text-sm font-sans">
          <thead className="bg-bg-2 text-left text-ink-dim">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Kind</th>
              <th className="px-4 py-2">Active</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {(channels.data ?? []).length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-ink-dim text-sm">
                  No sales channels yet.
                </td>
              </tr>
            ) : (
              (channels.data ?? []).map((c) => (
                <ChannelRow key={c.id} channel={c} canWrite={canWrite} />
              ))
            )}
          </tbody>
        </table>
      ) : null}

      {canWrite ? (
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
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as SalesChannelKind)}
                className="bg-bg-2 border border-line text-ink px-4 py-3 font-sans focus:outline-none focus:border-accent"
              >
                {CHANNEL_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
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
      ) : null}
    </section>
  );
}

function ChannelRow({ channel, canWrite }: { channel: SalesChannel; canWrite: boolean }) {
  const update = useUpdateSalesChannel(channel.id);

  return (
    <tr className="border-t border-line">
      <td className="px-4 py-2 text-ink">{channel.name}</td>
      <td className="px-4 py-2 text-ink-dim font-mono uppercase text-xs">{channel.kind}</td>
      <td className="px-4 py-2">
        <span className="inline-block px-2 py-0.5 border border-line text-xs font-mono uppercase text-ink-dim">
          {channel.is_active ? 'active' : 'inactive'}
        </span>
      </td>
      <td className="px-4 py-2">
        {canWrite ? (
          <Button
            variant="ghost"
            onClick={() => update.mutate({ is_active: !channel.is_active })}
            disabled={update.isPending}
          >
            {channel.is_active ? 'Deactivate' : 'Activate'}
          </Button>
        ) : null}
        {update.error ? (
          <span className="ml-2 text-accent text-xs">
            {update.error instanceof Error ? update.error.message : 'Update failed.'}
          </span>
        ) : null}
      </td>
    </tr>
  );
}
