// QuickCreateChannelModal. Minimal inline create for a sales channel, opened
// from the "+ New channel" row on ChannelPicker (F-UIUX-ENTITYPICKER-01). Scope
// is the required field only (name). kind is fixed to 'manual': copack-api
// rejects any other kind on create until connectors land. POSTs through the
// existing createSalesChannel service (Idempotency-Key minted by apiClient, org
// from the JWT), then hands the created record back so the parent picker can
// auto-select it.

import { useEffect, useState, type FormEvent } from 'react';

import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { useCreateSalesChannel } from '@/lib/hooks/useCoPack';
import type { SalesChannel } from '@/lib/types/copack';

export interface QuickCreateChannelModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (channel: SalesChannel) => void;
  initialName?: string;
}

export function QuickCreateChannelModal({
  open,
  onClose,
  onCreated,
  initialName = '',
}: QuickCreateChannelModalProps): JSX.Element | null {
  const create = useCreateSalesChannel();
  const [name, setName] = useState(initialName);

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    create.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialName]);

  if (!open) return null;

  const trimmed = name.trim();
  const pending = create.isPending;
  const errorMessage = create.error instanceof Error ? create.error.message : null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (trimmed === '') return;
    try {
      const channel = await create.mutateAsync({ name: trimmed, kind: 'manual' });
      onCreated(channel);
    } catch {
      // Error surfaces via the inline banner below.
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New channel"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="quick-create-channel-form" disabled={pending || trimmed === ''}>
            {pending ? 'Saving.' : 'Save channel'}
          </Button>
        </>
      }
    >
      <form id="quick-create-channel-form" onSubmit={onSubmit} className="flex flex-col gap-4">
        <TextInput
          label="Name"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Direct"
          required
          autoFocus
        />
        {errorMessage && (
          <p className="font-sans text-sm text-danger">{errorMessage}</p>
        )}
      </form>
    </Modal>
  );
}
