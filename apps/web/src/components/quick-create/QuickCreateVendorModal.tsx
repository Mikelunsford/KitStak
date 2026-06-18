// QuickCreateVendorModal. Minimal inline create for a vendor, opened from the
// "+ New vendor" row on VendorPicker (F-UIUX-ENTITYPICKER-01). Scope is the
// required field only (display_name); legal name, contact, and address stay on
// the full /purchasing/vendors/new page. POSTs through the existing createVendor
// service (Idempotency-Key minted by apiClient, org from the JWT), then hands
// the created record back so the parent picker can auto-select it.

import { useEffect, useState, type FormEvent } from 'react';

import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { useCreateVendor } from '@/lib/hooks/useVendors';
import type { Vendor } from '@/lib/types/vendors_inventory_ops';

export interface QuickCreateVendorModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (vendor: Vendor) => void;
  initialName?: string;
}

export function QuickCreateVendorModal({
  open,
  onClose,
  onCreated,
  initialName = '',
}: QuickCreateVendorModalProps): JSX.Element | null {
  const create = useCreateVendor();
  const [displayName, setDisplayName] = useState(initialName);

  useEffect(() => {
    if (!open) return;
    setDisplayName(initialName);
    create.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialName]);

  if (!open) return null;

  const trimmed = displayName.trim();
  const pending = create.isPending;
  const errorMessage = create.error instanceof Error ? create.error.message : null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (trimmed === '') return;
    try {
      const vendor = await create.mutateAsync({ display_name: trimmed });
      onCreated(vendor);
    } catch {
      // Error surfaces via the inline banner below.
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New vendor"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="quick-create-vendor-form" disabled={pending || trimmed === ''}>
            {pending ? 'Saving.' : 'Save vendor'}
          </Button>
        </>
      }
    >
      <form id="quick-create-vendor-form" onSubmit={onSubmit} className="flex flex-col gap-4">
        <TextInput
          label="Name"
          name="display_name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Globex Supply"
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
