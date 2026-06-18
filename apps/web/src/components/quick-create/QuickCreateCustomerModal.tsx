// QuickCreateCustomerModal. Minimal inline create for a customer, opened from
// the "+ New customer" row on CustomerPicker (F-UIUX-ENTITYPICKER-01).
//
// Scope is the required field only (display_name). Advanced fields stay on the
// full /crm/customers/new page. On save it POSTs through the existing
// createCustomer service (Idempotency-Key minted by apiClient, org from the
// JWT, one audit row server-side), then hands the created record back so the
// parent picker can auto-select it without the operator leaving the form.

import { useEffect, useState, type FormEvent } from 'react';

import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/TextInput';
import { useCreateCustomer } from '@/lib/hooks/useCustomers';
import type { Customer } from '@/lib/types/crm';

export interface QuickCreateCustomerModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (customer: Customer) => void;
  /** Optional seed for the name, e.g. the text already typed in the picker. */
  initialName?: string;
}

export function QuickCreateCustomerModal({
  open,
  onClose,
  onCreated,
  initialName = '',
}: QuickCreateCustomerModalProps): JSX.Element | null {
  const create = useCreateCustomer();
  const [displayName, setDisplayName] = useState(initialName);

  // Reset the field and any prior error each time the modal opens.
  useEffect(() => {
    if (!open) return;
    setDisplayName(initialName);
    create.reset();
    // The mutation handle is reset as a one-shot side effect of opening, not a
    // reactive dependency.
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
      // kind and tags carry the schema defaults; the full /crm/customers/new
      // page is where those get set deliberately.
      const customer = await create.mutateAsync({
        display_name: trimmed,
        kind: 'company',
        tags: [],
      });
      onCreated(customer);
    } catch {
      // Error surfaces via the inline banner below.
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New customer"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="quick-create-customer-form" disabled={pending || trimmed === ''}>
            {pending ? 'Saving.' : 'Save customer'}
          </Button>
        </>
      }
    >
      <form id="quick-create-customer-form" onSubmit={onSubmit} className="flex flex-col gap-4">
        <TextInput
          label="Name"
          name="display_name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Acme Co."
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
