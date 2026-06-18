import { useMemo, useState } from 'react';

import { EntityPicker } from '@/components/ui/EntityPicker';
import { QuickCreateChannelModal } from '@/components/quick-create/QuickCreateChannelModal';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { useSalesChannelsList } from '@/lib/hooks/useCoPack';
import type { SalesChannel } from '@/lib/types/copack';

/**
 * ChannelPicker. Typeahead combobox over the org's sales channels (copack-api),
 * with an inline "+ New channel" row gated on the copack.channel.write
 * capability (F-UIUX-ENTITYPICKER-01). New in this wave: the sales-order create
 * form previously bound a raw Select. Channels are optional on a sales order, so
 * the picker is clearable by default.
 */
export interface ChannelPickerProps {
  value: string | null;
  onChange: (id: string | null) => void;
  label?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
}

export function ChannelPicker({
  value,
  onChange,
  label = 'Channel',
  required = false,
  disabled = false,
  placeholder = 'No channel',
}: ChannelPickerProps) {
  const { can } = useCapabilities();
  const [createOpen, setCreateOpen] = useState(false);
  const [justCreated, setJustCreated] = useState<SalesChannel | null>(null);

  const { data, isLoading } = useSalesChannelsList();

  const options = useMemo(() => {
    const all = data ?? [];
    if (justCreated && !all.some((c) => c.id === justCreated.id)) {
      return [justCreated, ...all];
    }
    return all;
  }, [data, justCreated]);

  return (
    <>
      <EntityPicker<SalesChannel>
        value={value}
        onChange={(id) => onChange(id)}
        options={options}
        getOptionId={(c) => c.id}
        getOptionLabel={(c) => c.name}
        label={label}
        required={required}
        disabled={disabled}
        loading={isLoading}
        placeholder={placeholder}
        allowCreate={can('copack.channel.write')}
        createLabel="New channel"
        onCreate={() => setCreateOpen(true)}
      />
      <QuickCreateChannelModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(channel) => {
          setJustCreated(channel);
          onChange(channel.id);
          setCreateOpen(false);
        }}
      />
    </>
  );
}
